import {
  MODEL_REGISTRY_VERSION,
  modelRegistryV2,
  modelRegistryV2Schema,
} from "@free-ai-open/model-registry";
import type { ContextPreset, ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { CapabilityConfidence } from "@free-ai-open/types";
import type {
  RouterDecision,
  RouterInput,
  RouterReasonCode,
  RouterWarningCode,
} from "./adaptiveRouterContracts";
import { getAdaptiveRejectionReasons, rejectCandidate } from "./adaptiveEligibility";
import { buildAdaptiveFallbackChain } from "./adaptiveFallback";
import type { EligibleCandidate, NormalizedRouterInput } from "./adaptiveInternal";
import { normalizeRouterInput } from "./adaptiveNormalization";
import { summarizeObservations } from "./adaptiveObservations";
import {
  compareScores,
  reasonsForSelection,
  scoreCandidate,
  warningsForCandidate,
} from "./adaptiveScoring";

export const ADAPTIVE_ROUTER_DECISION_VERSION = "1.0.0";

export interface AdaptiveRouterOptions {
  registry?: readonly ModelRegistryRecord[];
  registryVersion?: string;
  now?: () => Date;
  maxFallbacks?: number;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function noDecision(registryVersion: string, warnings: RouterWarningCode[]): RouterDecision {
  return {
    selectedModelId: null,
    fallbackModelIds: [],
    confidence: "low",
    reasons: [],
    warnings: unique(warnings),
    rejectedModels: [],
    candidateScores: [],
    recommendedContextTokens: 0,
    recommendedMaxOutputTokens: 0,
    registryVersion,
    decisionVersion: `${ADAPTIVE_ROUTER_DECISION_VERSION}:${registryVersion}`,
  };
}

function hasStrongPerformanceEvidence(input: NormalizedRouterInput, candidate: EligibleCandidate): boolean {
  const benchmark = input.benchmark;
  const benchmarkStrong = benchmark?.status === "completed" && benchmark.stability === "stable" &&
    benchmark.confidence !== "low" && (benchmark.computeScore ?? 0) >= 60;
  const observationsStrong = candidate.observations.completed >= 2 && candidate.observations.stalls === 0 &&
    candidate.observations.outOfMemory === 0 && candidate.observations.deviceLosses === 0 &&
    (candidate.observations.maxTestedContextTokens ?? 0) >=
      (candidate.model.contextPresets.find((preset) => preset.id === "performance")?.contextTokens ?? Number.POSITIVE_INFINITY);
  return input.capability.capabilityClass === "performance" && input.capability.confidence !== "low" &&
    (benchmarkStrong || observationsStrong);
}

function selectPreset(
  input: NormalizedRouterInput,
  candidate: EligibleCandidate,
  warnings: RouterWarningCode[]
): ContextPreset {
  let id: ContextPreset["id"] = "balanced";
  if (input.performanceMode === "fast") id = "compatibility";
  else if (input.performanceMode === "balanced" && input.capability.confidence === "low") id = "compatibility";
  else if (input.performanceMode === "performance") {
    if (hasStrongPerformanceEvidence(input, candidate)) id = "performance";
    else warnings.push("performance_evidence_limited");
  }
  return candidate.model.contextPresets.find((preset) => preset.id === id) ?? candidate.model.contextPresets[0]!;
}

function decisionConfidence(input: NormalizedRouterInput, candidate: EligibleCandidate): CapabilityConfidence {
  if (input.warnings.includes("registry_version_mismatch") || input.warnings.includes("capability_stale")) return "low";
  const benchmarkStrong = input.benchmark?.status === "completed" && input.benchmark.confidence !== "low" &&
    input.benchmark.stability === "stable";
  const observationsStrong = candidate.observations.effectiveCount >= 2 && candidate.observations.completed >= 2;
  if (input.capability.confidence === "high" && benchmarkStrong && observationsStrong) return "high";
  if (input.capability.confidence !== "low" && (benchmarkStrong || candidate.observations.effectiveCount > 0)) return "medium";
  return "low";
}

function isMarginalManualChoice(input: NormalizedRouterInput, candidate: EligibleCandidate): boolean {
  return candidate.model.tasks[input.task] < 3 ||
    candidate.model.languages[input.locale] === "limited" ||
    candidate.model.languages[input.locale] === "unknown" ||
    (input.capability.formFactor !== "unknown" && candidate.model.formFactors[input.capability.formFactor] < 2);
}

export function routeAdaptiveModel(input: RouterInput, options: AdaptiveRouterOptions = {}): RouterDecision {
  const registryVersion = options.registryVersion ?? MODEL_REGISTRY_VERSION;
  const parsedRegistry = modelRegistryV2Schema.safeParse(options.registry ?? modelRegistryV2);
  if (!parsedRegistry.success) return noDecision(registryVersion, ["registry_invalid", "no_eligible_model"]);

  const registry = parsedRegistry.data;
  const knownIds = new Set(registry.map((model) => model.id));
  const normalized = normalizeRouterInput(input, knownIds, registryVersion, (options.now ?? (() => new Date()))());
  const eligible: EligibleCandidate[] = [];
  const rejectedModels: RouterDecision["rejectedModels"] = [];

  for (const model of registry) {
    const observations = summarizeObservations(normalized.observations.filter((item) => item.modelId === model.id));
    const rejectionReasons = getAdaptiveRejectionReasons(normalized, model, observations);
    if (rejectionReasons.length > 0) rejectedModels.push(rejectCandidate(model.id, rejectionReasons));
    else eligible.push({ model, observations });
  }

  const candidateScores = eligible.map((candidate) => scoreCandidate(normalized, candidate)).sort(compareScores);
  const candidatesById = new Map(eligible.map((candidate) => [candidate.model.id, candidate]));
  const warnings = [...normalized.warnings];
  let selected = candidateScores[0] ? candidatesById.get(candidateScores[0].modelId) : undefined;
  const reasons: RouterReasonCode[] = [];

  if (input.manualModelId) {
    const manual = candidatesById.get(input.manualModelId);
    if (!knownIds.has(input.manualModelId)) warnings.push("manual_model_unknown");
    else if (!manual) warnings.push("manual_model_ineligible");
    else {
      selected = manual;
      reasons.push("manual_selection");
      if (isMarginalManualChoice(normalized, manual)) warnings.push("manual_choice_marginal");
    }
  }

  if (!selected) {
    return {
      ...noDecision(registryVersion, [...warnings, "no_eligible_model"]),
      rejectedModels,
    };
  }

  reasons.push(...reasonsForSelection(normalized, selected));
  warnings.push(...warningsForCandidate(normalized, selected));
  const preset = selectPreset(normalized, selected, warnings);
  return {
    selectedModelId: selected.model.id,
    fallbackModelIds: buildAdaptiveFallbackChain(selected.model, eligible, registry, options.maxFallbacks),
    confidence: decisionConfidence(normalized, selected),
    reasons: unique(reasons),
    warnings: unique(warnings),
    rejectedModels,
    candidateScores,
    recommendedContextTokens: preset.contextTokens,
    recommendedMaxOutputTokens: preset.maxOutputTokens,
    registryVersion,
    decisionVersion: `${ADAPTIVE_ROUTER_DECISION_VERSION}:${registryVersion}`,
  };
}

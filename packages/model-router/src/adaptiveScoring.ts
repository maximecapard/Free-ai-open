import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { RouterReasonCode, RouterScoreBreakdown, RouterWarningCode } from "./adaptiveRouterContracts";
import type { EligibleCandidate, NormalizedRouterInput, ObservationSummary } from "./adaptiveInternal";

const LANGUAGE_SCORE = { strong: 15, usable: 11, limited: 4, unknown: 0 } as const;

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function parameterBillions(parameterClass: string | undefined): number | undefined {
  if (!parameterClass) return undefined;
  const match = /^(\d+(?:\.\d+)?)([bm])$/i.exec(parameterClass);
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2]?.toLowerCase() === "m" ? value / 1000 : value;
}

function observedScore(observations: ObservationSummary): number {
  if (observations.effectiveCount === 0) return 15;
  const effective = observations.effectiveCount;
  const load = (observations.successfulLoads / effective) * 5;
  const completion = (observations.completed / effective) * 10;
  const speed = observations.averageTokensPerSecond === undefined ? 3.5 : clamp(observations.averageTokensPerSecond / 2, 7);
  const firstToken = observations.averageFirstTokenMs === undefined ? 2 : clamp(4 - observations.averageFirstTokenMs / 1000, 4);
  const loadTime = observations.averageLoadTimeMs === undefined ? 2 : clamp(4 - observations.averageLoadTimeMs / 5000, 4);
  const penalties = observations.stalls * 4 + observations.outOfMemory * 6 + observations.deviceLosses * 6 +
    observations.degenerate * 2 + observations.loadFailures * 4;
  return clamp(load + completion + speed + firstToken + loadTime - penalties, 30);
}

function capabilityScore(input: NormalizedRouterInput, model: ModelRegistryRecord): number {
  const formFactor = input.capability.formFactor;
  const formScore = formFactor === "unknown" ? 3 : (model.formFactors[formFactor] / 5) * 6;

  const runtimeBytes = model.runtimeMemory.value;
  const memoryBytes = input.capability.approximateMemoryGB ? input.capability.approximateMemoryGB * 1024 ** 3 : undefined;
  const memoryRatio = runtimeBytes && memoryBytes ? runtimeBytes / memoryBytes : undefined;
  const memoryScore = memoryRatio === undefined ? 2.5 : memoryRatio <= 0.3 ? 5 : memoryRatio <= 0.45 ? 3.5 : 1.5;

  const size = parameterBillions(model.parameterClass);
  const classTarget = { compatibility: 0.4, light: 0.8, balanced: 2, performance: 5 }[input.capability.capabilityClass];
  const staticFit = size === undefined ? 2 : clamp((classTarget / size) * 4, 4);

  const benchmark = input.benchmark;
  let measuredFit = 2.5;
  if (benchmark?.status === "completed" && benchmark.computeScore !== undefined) {
    const target = size === undefined ? 50 : size >= 4 ? 75 : size >= 1.5 ? 50 : size >= 0.6 ? 25 : 15;
    measuredFit = clamp((benchmark.computeScore / target) * 5, 5);
  }
  return clamp(formScore + memoryScore + staticFit + measuredFit, 20);
}

function convenienceScore(input: NormalizedRouterInput, model: ModelRegistryRecord): number {
  const cached = input.cachedModelIds.has(model.id) ? 3 : 0;
  const bytes = model.downloadSize.value;
  const download = bytes === undefined ? 0 : bytes <= 400_000_000 ? 2 : bytes <= 1_000_000_000 ? 1 : -2;
  return Math.max(-2, Math.min(5, cached + download));
}

export function scoreCandidate(input: NormalizedRouterInput, candidate: EligibleCandidate): RouterScoreBreakdown {
  const observed = observedScore(candidate.observations);
  const capability = capabilityScore(input, candidate.model);
  const task = (candidate.model.tasks[input.task] / 5) * 20;
  const language = LANGUAGE_SCORE[candidate.model.languages[input.locale]];
  const performanceMode = (candidate.model.performanceModes[input.performanceMode] / 5) * 10;
  const convenience = convenienceScore(input, candidate.model);
  return {
    modelId: candidate.model.id,
    total: Number((observed + capability + task + language + performanceMode + convenience).toFixed(3)),
    observed: Number(observed.toFixed(3)),
    capability: Number(capability.toFixed(3)),
    task: Number(task.toFixed(3)),
    language,
    performanceMode: Number(performanceMode.toFixed(3)),
    convenience: Number(convenience.toFixed(3)),
  };
}

export function compareScores(left: RouterScoreBreakdown, right: RouterScoreBreakdown): number {
  return right.total - left.total || left.modelId.localeCompare(right.modelId);
}

export function reasonsForSelection(input: NormalizedRouterInput, candidate: EligibleCandidate): RouterReasonCode[] {
  const reasons: RouterReasonCode[] = [];
  if (candidate.model.tasks[input.task] >= 4) reasons.push("task_match");
  if (candidate.model.languages[input.locale] === "strong" || candidate.model.languages[input.locale] === "usable") reasons.push("language_match");
  if (candidate.observations.completed >= 2 && candidate.observations.stalls === 0) reasons.push("measured_stable");
  if ((candidate.observations.averageTokensPerSecond ?? 0) >= 12) reasons.push("measured_fast");
  if (input.capability.formFactor !== "desktop" && candidate.model.formFactors[input.capability.formFactor === "unknown" ? "mobile" : input.capability.formFactor] >= 4) reasons.push("mobile_optimized");
  if (input.cachedModelIds.has(candidate.model.id)) reasons.push("cached_locally");
  if (candidate.model.runtimeMemory.value && input.capability.approximateMemoryGB &&
      candidate.model.runtimeMemory.value < input.capability.approximateMemoryGB * 1024 ** 3 * 0.35) reasons.push("resource_margin");
  if (candidate.model.performanceModes[input.performanceMode] >= 4) reasons.push("performance_mode_match");
  return reasons.length > 0 ? reasons : ["compatibility_fallback"];
}

export function warningsForCandidate(input: NormalizedRouterInput, candidate: EligibleCandidate): RouterWarningCode[] {
  const warnings: RouterWarningCode[] = [];
  if (!candidate.model.runtimeMemory.value || !input.capability.approximateMemoryGB) warnings.push("resource_unknown");
  if (candidate.observations.stalls > 0) warnings.push("previous_stall");
  if (candidate.observations.outOfMemory > 0) warnings.push("previous_oom");
  if (candidate.observations.deviceLosses > 0) warnings.push("previous_device_loss");
  if ((candidate.model.downloadSize.value ?? 0) > 1_000_000_000 && !input.cachedModelIds.has(candidate.model.id)) warnings.push("download_large");
  return warnings;
}

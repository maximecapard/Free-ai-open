import { taskCategories } from "@free-ai-open/types";
import type { LocalBenchmarkResult, StaticCapabilityProfile } from "@free-ai-open/types";
import type { RouterInput, RouterWarningCode } from "./adaptiveRouterContracts";
import type { NormalizedRouterInput } from "./adaptiveInternal";
import { normalizeObservations } from "./adaptiveObservations";

const SUPPORTED_CAPABILITY_SCHEMA_VERSION = 2;

function validBenchmark(benchmark: LocalBenchmarkResult | undefined, now: Date): benchmark is LocalBenchmarkResult {
  if (!benchmark || benchmark.schemaVersion !== 2) return false;
  const measuredAt = Date.parse(benchmark.measuredAt);
  const expiresAt = Date.parse(benchmark.expiresAt);
  if (!Number.isFinite(measuredAt) || !Number.isFinite(expiresAt) || measuredAt > now.getTime() || expiresAt <= now.getTime()) return false;
  return benchmark.computeScore === undefined ||
    (Number.isFinite(benchmark.computeScore) && benchmark.computeScore >= 0 && benchmark.computeScore <= 100);
}

function normalizeCapability(capability: StaticCapabilityProfile): StaticCapabilityProfile {
  const source = capability as unknown as Record<string, unknown>;
  const gpu = source.gpu && typeof source.gpu === "object" ? source.gpu as Record<string, unknown> : {};
  const featureClasses = Array.isArray(gpu.featureClasses)
    ? gpu.featureClasses.filter((value): value is string => typeof value === "string").slice(0, 32).sort()
    : [];
  const limitClasses: StaticCapabilityProfile["gpu"]["limitClasses"] = {};
  if (gpu.limitClasses && typeof gpu.limitClasses === "object") {
    for (const [key, value] of Object.entries(gpu.limitClasses)) {
      if (value === "low" || value === "medium" || value === "high" || value === "very_high" || value === "unknown") {
        limitClasses[key] = value;
      }
    }
  }
  const formFactor = source.formFactor === "mobile" || source.formFactor === "tablet" || source.formFactor === "desktop"
    ? source.formFactor : "unknown";
  const capabilityClass = source.capabilityClass === "light" || source.capabilityClass === "balanced" || source.capabilityClass === "performance"
    ? source.capabilityClass : "compatibility";
  const invalidSignals = formFactor === "unknown" && source.formFactor !== "unknown" ||
    capabilityClass === "compatibility" && source.capabilityClass !== "compatibility" ||
    Array.isArray(gpu.featureClasses) && gpu.featureClasses.some((value) => typeof value !== "string") ||
    Object.values(gpu.limitClasses && typeof gpu.limitClasses === "object" ? gpu.limitClasses : {}).some(
      (value) => value !== "low" && value !== "medium" && value !== "high" && value !== "very_high" && value !== "unknown"
    ) ||
    source.approximateMemoryGB !== undefined &&
      (typeof source.approximateMemoryGB !== "number" || !Number.isFinite(source.approximateMemoryGB) || source.approximateMemoryGB <= 0);
  const confidence = !invalidSignals && (source.confidence === "medium" || source.confidence === "high") ? source.confidence : "low";
  const approximateMemoryGB = typeof source.approximateMemoryGB === "number" && Number.isFinite(source.approximateMemoryGB) && source.approximateMemoryGB > 0
    ? source.approximateMemoryGB : undefined;
  return {
    ...capability,
    formFactor,
    capabilityClass,
    webgpuAvailable: source.webgpuAvailable === true,
    wasmAvailable: source.wasmAvailable === true,
    fallbackAdapter: source.fallbackAdapter === true,
    approximateMemoryGB,
    confidence,
    gpu: { ...capability.gpu, featureClasses, limitClasses },
  };
}

function unsupportedCapabilityProfile(capability: StaticCapabilityProfile): StaticCapabilityProfile {
  return {
    ...capability,
    formFactor: "unknown",
    architectureClass: "unknown",
    memoryClass: "unknown",
    logicalProcessorClass: "unknown",
    approximateMemoryGB: undefined,
    logicalProcessors: undefined,
    webgpuAvailable: false,
    wasmAvailable: false,
    fallbackAdapter: undefined,
    capabilityClass: "compatibility",
    gpu: { featureClasses: [], limitClasses: {} },
    confidence: "low",
  };
}

export function normalizeRouterInput(
  input: RouterInput,
  knownModelIds: ReadonlySet<string>,
  actualRegistryVersion: string,
  now: Date
): NormalizedRouterInput {
  const warnings: RouterWarningCode[] = [];
  const capabilitySchemaSupported = input.capability.schemaVersion === SUPPORTED_CAPABILITY_SCHEMA_VERSION;
  const capability = capabilitySchemaSupported
    ? normalizeCapability(input.capability)
    : unsupportedCapabilityProfile(input.capability);
  if (!capabilitySchemaSupported) warnings.push("capability_schema_unsupported");
  const capabilityExpired = !Number.isFinite(Date.parse(capability.expiresAt)) || Date.parse(capability.expiresAt) <= now.getTime();
  if (capabilityExpired) warnings.push("capability_stale");
  if (input.registryVersion !== actualRegistryVersion) warnings.push("registry_version_mismatch");

  const benchmark = validBenchmark(input.benchmark, now) ? input.benchmark : undefined;
  if (!benchmark) warnings.push("benchmark_missing");
  else if (benchmark.status !== "completed" || benchmark.confidence === "low" || benchmark.stability !== "stable") {
    warnings.push("benchmark_low_confidence");
  }

  return {
    ...input,
    task: taskCategories.includes(input.task) ? input.task : "chat",
    locale: input.locale === "fr" ? "fr" : "en",
    performanceMode: input.performanceMode === "fast" || input.performanceMode === "performance" ? input.performanceMode : "balanced",
    capability: capabilityExpired ? { ...capability, confidence: "low" } : capability,
    benchmark,
    observations: normalizeObservations(Array.isArray(input.observations) ? input.observations : [], knownModelIds, now),
    cachedModelIds: new Set((Array.isArray(input.cachedModelIds) ? input.cachedModelIds : []).filter((modelId) => knownModelIds.has(modelId))),
    warnings,
  };
}

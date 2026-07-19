import {
  browserFamilies,
  buildCapabilityProfileKey,
  experimentalMemoryClasses,
  gpuArchitectureClasses,
  gpuDescriptionClasses,
  gpuFeatureClasses,
  gpuLimitClasses,
  gpuLimitKeys,
  gpuVendorClasses,
  osFamilies,
  taskCategories,
} from "@free-ai-open/types";
import type { LocalBenchmarkResult, StaticCapabilityProfile } from "@free-ai-open/types";
import type { RouterInput, RouterWarningCode } from "./adaptiveRouterContracts";
import type { NormalizedRouterInput } from "./adaptiveInternal";
import { normalizeObservations } from "./adaptiveObservations";

const SUPPORTED_CAPABILITY_SCHEMA_VERSION = 2;
const BROWSER_FAMILIES = new Set<string>(browserFamilies);
const OS_FAMILIES = new Set<string>(osFamilies);
const GPU_VENDOR_CLASSES = new Set<string>(gpuVendorClasses);
const GPU_ARCHITECTURE_CLASSES = new Set<string>(gpuArchitectureClasses);
const GPU_DESCRIPTION_CLASSES = new Set<string>(gpuDescriptionClasses);
const GPU_FEATURE_CLASSES = new Set<string>(gpuFeatureClasses);
const GPU_LIMIT_KEYS = new Set<string>(gpuLimitKeys);
const GPU_LIMIT_CLASSES = new Set<string>(gpuLimitClasses);
const EXPERIMENTAL_MEMORY_CLASSES = new Set<string>(experimentalMemoryClasses);
const INVALID_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function normalizedTimestamp(value: unknown): string {
  if (typeof value !== "string") return INVALID_TIMESTAMP;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : INVALID_TIMESTAMP;
}

function validBenchmark(
  benchmark: LocalBenchmarkResult | undefined,
  capability: StaticCapabilityProfile,
  now: Date
): benchmark is LocalBenchmarkResult {
  if (!benchmark || benchmark.schemaVersion !== 2) return false;
  const measuredAt = Date.parse(benchmark.measuredAt);
  const expiresAt = Date.parse(benchmark.expiresAt);
  if (
    !Number.isFinite(measuredAt) ||
    !Number.isFinite(expiresAt) ||
    measuredAt > now.getTime() ||
    expiresAt <= measuredAt ||
    expiresAt <= now.getTime()
  ) return false;
  if (benchmark.capabilityProfileKey !== buildCapabilityProfileKey(capability)) return false;
  return benchmark.computeScore === undefined ||
    (Number.isFinite(benchmark.computeScore) && benchmark.computeScore >= 0 && benchmark.computeScore <= 100);
}

function normalizeCapability(capability: StaticCapabilityProfile): StaticCapabilityProfile {
  const source = capability as unknown as Record<string, unknown>;
  const gpu = source.gpu && typeof source.gpu === "object" ? source.gpu as Record<string, unknown> : {};
  const featureClasses = Array.isArray(gpu.featureClasses)
    ? gpu.featureClasses
        .filter((value): value is string => typeof value === "string" && GPU_FEATURE_CLASSES.has(value))
        .slice(0, GPU_FEATURE_CLASSES.size)
        .sort()
    : [];
  const limitClasses: StaticCapabilityProfile["gpu"]["limitClasses"] = {};
  if (gpu.limitClasses && typeof gpu.limitClasses === "object") {
    for (const [key, value] of Object.entries(gpu.limitClasses)) {
      if (GPU_LIMIT_KEYS.has(key) && typeof value === "string" && GPU_LIMIT_CLASSES.has(value)) {
        limitClasses[key] = value as StaticCapabilityProfile["gpu"]["limitClasses"][string];
      }
    }
  }
  const formFactor = source.formFactor === "mobile" || source.formFactor === "tablet" || source.formFactor === "desktop"
    ? source.formFactor : "unknown";
  const capabilityClass = source.capabilityClass === "light" || source.capabilityClass === "balanced" || source.capabilityClass === "performance"
    ? source.capabilityClass : "compatibility";
  const architectureClass = source.architectureClass === "arm" || source.architectureClass === "x86"
    ? source.architectureClass : "unknown";
  const browserFamily = typeof source.browserFamily === "string" && BROWSER_FAMILIES.has(source.browserFamily)
    ? source.browserFamily : "unknown";
  const osFamily = typeof source.osFamily === "string" && OS_FAMILIES.has(source.osFamily)
    ? source.osFamily : "unknown";
  const memoryClass = source.memoryClass === "low" || source.memoryClass === "medium" || source.memoryClass === "high"
    ? source.memoryClass : "unknown";
  const logicalProcessorClass = source.logicalProcessorClass === "low" || source.logicalProcessorClass === "medium" || source.logicalProcessorClass === "high"
    ? source.logicalProcessorClass : "unknown";
  const approximateMemoryGB = typeof source.approximateMemoryGB === "number" && Number.isFinite(source.approximateMemoryGB) &&
    source.approximateMemoryGB > 0 && source.approximateMemoryGB <= 1024
    ? source.approximateMemoryGB : undefined;
  const logicalProcessors = typeof source.logicalProcessors === "number" && Number.isInteger(source.logicalProcessors) &&
    source.logicalProcessors > 0 && source.logicalProcessors <= 1024
    ? source.logicalProcessors : undefined;
  const deviceTier = source.deviceTier === 0 || source.deviceTier === 1 || source.deviceTier === 2 ||
    source.deviceTier === 3 || source.deviceTier === 4 ? source.deviceTier : 0;
  const vendorClass = typeof gpu.vendorClass === "string" && GPU_VENDOR_CLASSES.has(gpu.vendorClass)
    ? gpu.vendorClass as StaticCapabilityProfile["gpu"]["vendorClass"] : undefined;
  const gpuArchitectureClass = typeof gpu.architectureClass === "string" && GPU_ARCHITECTURE_CLASSES.has(gpu.architectureClass)
    ? gpu.architectureClass as StaticCapabilityProfile["gpu"]["architectureClass"] : undefined;
  const descriptionClass = typeof gpu.descriptionClass === "string" && GPU_DESCRIPTION_CLASSES.has(gpu.descriptionClass)
    ? gpu.descriptionClass as StaticCapabilityProfile["gpu"]["descriptionClass"] : undefined;
  const experimentalMemoryClass = typeof gpu.experimentalMemoryClass === "string" && EXPERIMENTAL_MEMORY_CLASSES.has(gpu.experimentalMemoryClass)
    ? gpu.experimentalMemoryClass as StaticCapabilityProfile["gpu"]["experimentalMemoryClass"] : undefined;
  const invalidSignals = formFactor === "unknown" && source.formFactor !== "unknown" ||
    capabilityClass === "compatibility" && source.capabilityClass !== "compatibility" ||
    architectureClass === "unknown" && source.architectureClass !== "unknown" ||
    browserFamily === "unknown" && source.browserFamily !== "unknown" ||
    osFamily === "unknown" && source.osFamily !== "unknown" ||
    memoryClass === "unknown" && source.memoryClass !== "unknown" ||
    logicalProcessorClass === "unknown" && source.logicalProcessorClass !== "unknown" ||
    deviceTier === 0 && source.deviceTier !== 0 ||
    typeof source.webgpuAvailable !== "boolean" ||
    typeof source.wasmAvailable !== "boolean" ||
    source.fallbackAdapter !== undefined && typeof source.fallbackAdapter !== "boolean" ||
    vendorClass === undefined && gpu.vendorClass !== undefined ||
    gpuArchitectureClass === undefined && gpu.architectureClass !== undefined ||
    descriptionClass === undefined && gpu.descriptionClass !== undefined ||
    experimentalMemoryClass === undefined && gpu.experimentalMemoryClass !== undefined ||
    gpu.experimentalMemoryConfidence !== undefined && gpu.experimentalMemoryConfidence !== "low" ||
    Array.isArray(gpu.featureClasses) && gpu.featureClasses.some(
      (value) => typeof value !== "string" || !GPU_FEATURE_CLASSES.has(value)
    ) ||
    Object.entries(gpu.limitClasses && typeof gpu.limitClasses === "object" ? gpu.limitClasses : {}).some(
      ([key, value]) => !GPU_LIMIT_KEYS.has(key) || typeof value !== "string" || !GPU_LIMIT_CLASSES.has(value)
    ) ||
    (source.approximateMemoryGB !== undefined && approximateMemoryGB === undefined) ||
    (source.logicalProcessors !== undefined && logicalProcessors === undefined);
  const confidence = !invalidSignals && (source.confidence === "medium" || source.confidence === "high") ? source.confidence : "low";
  return {
    schemaVersion: capability.schemaVersion,
    detectedAt: normalizedTimestamp(source.detectedAt),
    expiresAt: normalizedTimestamp(source.expiresAt),
    formFactor,
    architectureClass,
    browserFamily,
    osFamily,
    memoryClass,
    logicalProcessorClass,
    ...(approximateMemoryGB !== undefined ? { approximateMemoryGB } : {}),
    ...(logicalProcessors !== undefined ? { logicalProcessors } : {}),
    capabilityClass,
    webgpuAvailable: source.webgpuAvailable === true,
    wasmAvailable: source.wasmAvailable === true,
    ...(typeof source.fallbackAdapter === "boolean" ? { fallbackAdapter: source.fallbackAdapter } : {}),
    deviceTier,
    confidence,
    gpu: {
      ...(vendorClass ? { vendorClass } : {}),
      ...(gpuArchitectureClass ? { architectureClass: gpuArchitectureClass } : {}),
      ...(descriptionClass ? { descriptionClass } : {}),
      featureClasses,
      limitClasses,
      ...(experimentalMemoryClass ? { experimentalMemoryClass } : {}),
      ...(gpu.experimentalMemoryConfidence === "low" ? { experimentalMemoryConfidence: "low" as const } : {}),
    },
  };
}

function unsupportedCapabilityProfile(capability: StaticCapabilityProfile): StaticCapabilityProfile {
  return {
    schemaVersion: capability.schemaVersion,
    detectedAt: normalizedTimestamp(capability.detectedAt),
    expiresAt: normalizedTimestamp(capability.expiresAt),
    formFactor: "unknown",
    architectureClass: "unknown",
    browserFamily: "unknown",
    osFamily: "unknown",
    memoryClass: "unknown",
    logicalProcessorClass: "unknown",
    approximateMemoryGB: undefined,
    logicalProcessors: undefined,
    webgpuAvailable: false,
    wasmAvailable: false,
    fallbackAdapter: undefined,
    capabilityClass: "compatibility",
    deviceTier: 0,
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
  const detectedAt = Date.parse(capability.detectedAt);
  const expiresAt = Date.parse(capability.expiresAt);
  const capabilityExpired = !Number.isFinite(detectedAt) ||
    !Number.isFinite(expiresAt) ||
    detectedAt > now.getTime() ||
    expiresAt <= detectedAt ||
    expiresAt <= now.getTime();
  if (capabilityExpired) warnings.push("capability_stale");
  if (input.registryVersion !== actualRegistryVersion) warnings.push("registry_version_mismatch");

  const benchmark = validBenchmark(input.benchmark, capability, now) ? input.benchmark : undefined;
  if (!benchmark) warnings.push("benchmark_missing");
  else if (benchmark.status !== "completed" || benchmark.confidence === "low" || benchmark.stability !== "stable") {
    warnings.push("benchmark_low_confidence");
  }

  return {
    task: taskCategories.includes(input.task) ? input.task : "chat",
    locale: input.locale === "fr" ? "fr" : "en",
    performanceMode: input.performanceMode === "fast" || input.performanceMode === "performance" ? input.performanceMode : "balanced",
    capability: capabilityExpired ? { ...capability, confidence: "low" } : capability,
    benchmark,
    observations: normalizeObservations(Array.isArray(input.observations) ? input.observations : [], knownModelIds, now),
    cachedModelIds: new Set((Array.isArray(input.cachedModelIds) ? input.cachedModelIds : []).filter((modelId) => knownModelIds.has(modelId))),
    registryVersion: actualRegistryVersion,
    ...(input.manualModelId ? { manualModelId: input.manualModelId } : {}),
    warnings,
  };
}

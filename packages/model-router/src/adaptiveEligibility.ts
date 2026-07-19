import { isAutomaticRoutingEligible } from "@free-ai-open/model-registry";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { RouterRejectedModel, RouterRejectionCode } from "./adaptiveRouterContracts";
import type { NormalizedRouterInput, ObservationSummary } from "./adaptiveInternal";

const RECENT_FATAL_FAILURE_LIMIT = 2;
const RECENT_STALL_LIMIT = 2;
const SAFE_MEMORY_FRACTION = 0.55;

const LIMIT_CLASS_LOWER_BOUNDS: Record<string, Partial<Record<string, number>>> = {
  maxBufferSize: { medium: 128 * 1024 ** 2, high: 512 * 1024 ** 2, very_high: 1024 ** 3 },
  maxStorageBufferBindingSize: { medium: 128 * 1024 ** 2, high: 512 * 1024 ** 2, very_high: 1024 ** 3 },
  maxComputeWorkgroupStorageSize: { medium: 16 * 1024, high: 32 * 1024, very_high: 32 * 1024 },
  maxComputeInvocationsPerWorkgroup: { medium: 128, high: 256, very_high: 256 },
  maxBindGroups: { medium: 4, high: 5, very_high: 5 },
  maxBindingsPerBindGroup: { medium: 4, high: 5, very_high: 5 },
  maxStorageBuffersPerShaderStage: { medium: 4, high: 5, very_high: 5 },
};

function meetsMinimumLimit(limitKey: string, availableClass: string | undefined, required: number): boolean {
  if (required <= 0) return true;
  if (!availableClass || availableClass === "low" || availableClass === "unknown") return false;
  const lowerBound = LIMIT_CLASS_LOWER_BOUNDS[limitKey]?.[availableClass];
  return lowerBound !== undefined && lowerBound >= required;
}

function hasCompleteMetadata(model: ModelRegistryRecord): boolean {
  return Boolean(
    model.license.id && model.license.sourceUrl && model.source.modelUrl && model.source.modelLibUrl &&
    model.runtimeMemory.source && model.downloadSize.source && model.contextPresets.length > 0
  );
}

export function getAdaptiveRejectionReasons(
  input: NormalizedRouterInput,
  model: ModelRegistryRecord,
  observations: ObservationSummary
): RouterRejectionCode[] {
  const reasons: RouterRejectionCode[] = [];
  const capability = input.capability;
  if (!isAutomaticRoutingEligible(model)) reasons.push("model_not_verified");
  if (!hasCompleteMetadata(model)) reasons.push("metadata_incomplete");
  if (model.tasks[input.task] === 0) reasons.push("task_unsupported");

  const backendAvailable = model.minimumCapability.webgpuRequired
    ? capability.webgpuAvailable
    : capability.webgpuAvailable || (capability.wasmAvailable && model.minimumCapability.wasmSupported);
  if (!backendAvailable) reasons.push("backend_unavailable");
  if (capability.fallbackAdapter && !model.minimumCapability.fallbackAdapterAllowed) {
    reasons.push("fallback_adapter_unsupported");
  }

  for (const feature of model.minimumCapability.requiredFeatures ?? []) {
    if (!capability.gpu.featureClasses.includes(feature)) reasons.push("required_feature_missing");
  }
  for (const [limit, required] of Object.entries(model.minimumCapability.minimumLimits ?? {})) {
    if (!meetsMinimumLimit(limit, capability.gpu.limitClasses[limit], required)) reasons.push("required_limit_missing");
  }

  if (capability.formFactor !== "unknown" && model.formFactors[capability.formFactor] === 0) {
    reasons.push("form_factor_unsupported");
  }

  const estimatedMemoryBytes = model.runtimeMemory.value;
  if (estimatedMemoryBytes && capability.approximateMemoryGB) {
    const availableBytes = capability.approximateMemoryGB * 1024 ** 3 * SAFE_MEMORY_FRACTION;
    if (estimatedMemoryBytes > availableBytes) reasons.push("insufficient_memory");
  }
  if (model.minimumCapability.approximateMemoryGB && capability.approximateMemoryGB &&
      capability.approximateMemoryGB < model.minimumCapability.approximateMemoryGB) {
    reasons.push("insufficient_memory");
  }

  if (observations.outOfMemory >= RECENT_FATAL_FAILURE_LIMIT) reasons.push("repeated_oom");
  if (observations.deviceLosses >= RECENT_FATAL_FAILURE_LIMIT) reasons.push("repeated_device_loss");
  if (observations.stalls >= RECENT_STALL_LIMIT) reasons.push("repeated_stall");
  return [...new Set(reasons)];
}

export function rejectCandidate(modelId: string, reasons: RouterRejectionCode[]): RouterRejectedModel {
  return { modelId, reasons };
}

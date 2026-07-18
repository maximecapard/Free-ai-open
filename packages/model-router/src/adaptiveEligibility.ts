import { isAutomaticRoutingEligible } from "@free-ai-open/model-registry";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { RouterRejectedModel, RouterRejectionCode } from "./adaptiveRouterContracts";
import type { NormalizedRouterInput, ObservationSummary } from "./adaptiveInternal";

const RECENT_FATAL_FAILURE_LIMIT = 2;
const SAFE_MEMORY_FRACTION = 0.55;

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
  for (const limit of Object.keys(model.minimumCapability.minimumLimits ?? {})) {
    const available = capability.gpu.limitClasses[limit];
    if (!available || available === "low" || available === "unknown") reasons.push("required_limit_missing");
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
  return [...new Set(reasons)];
}

export function rejectCandidate(modelId: string, reasons: RouterRejectionCode[]): RouterRejectedModel {
  return { modelId, reasons };
}

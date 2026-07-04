import type { Backend } from "@free-ai-open/types";
import type { ModelRecord } from "@free-ai-open/model-registry";
import type { CompatibilityResult, ModelRouterInput, RejectedModel, RejectionReason } from "./types";

export function getAvailableBackends(input: ModelRouterInput): Backend[] {
  const backends: Backend[] = ["cpu"];

  if (input.deviceProfile.wasmAvailable) {
    backends.push("wasm");
  }

  if (input.deviceProfile.webgpuAvailable) {
    backends.push("webgpu");
  }

  return backends;
}

function hasAvailableBackend(modelBackends: readonly Backend[], availableBackends: readonly Backend[]): boolean {
  return modelBackends.some((backend) => availableBackends.includes(backend));
}

export function getModelRejectionReason(model: ModelRecord, input: ModelRouterInput): RejectionReason | null {
  if (model.status === "blocked") {
    return "model_blocked";
  }

  if (!model.tasks.includes(input.task)) {
    return "task_not_supported";
  }

  if (model.minDeviceTier > input.deviceProfile.deviceTier) {
    return "device_tier_too_low";
  }

  if (!hasAvailableBackend(model.backend, getAvailableBackends(input))) {
    return "backend_not_available";
  }

  return null;
}

export function rejectIncompatibleModels(input: ModelRouterInput): CompatibilityResult {
  const compatibleModels: ModelRecord[] = [];
  const rejectedModels: RejectedModel[] = [];

  for (const model of input.modelRegistry) {
    const rejectionReason = getModelRejectionReason(model, input);
    if (rejectionReason) {
      rejectedModels.push({ modelId: model.id, reason: rejectionReason });
      continue;
    }

    compatibleModels.push(model);
  }

  return { compatibleModels, rejectedModels };
}

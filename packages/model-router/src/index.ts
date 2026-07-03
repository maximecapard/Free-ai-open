import type { DeviceTier, PerformanceMode, TaskCategory } from "@free-ai-open/types";
import type { ModelRecord } from "@free-ai-open/model-registry";

export interface RouteModelInput {
  task: TaskCategory;
  performanceMode: PerformanceMode;
  deviceTier: DeviceTier;
  models: ModelRecord[];
}

export interface RouteModelResult {
  selectedModel: ModelRecord | null;
  rejected: Array<{ modelId: string; reason: string }>;
  reasonCode: string;
}

export function routeModel(input: RouteModelInput): RouteModelResult {
  const rejected: RouteModelResult["rejected"] = [];
  const candidates = input.models.filter((model) => {
    if (!model.tasks.includes(input.task)) {
      rejected.push({ modelId: model.id, reason: "task_not_supported" });
      return false;
    }
    if (model.minDeviceTier > input.deviceTier) {
      rejected.push({ modelId: model.id, reason: "device_tier_too_low" });
      return false;
    }
    if (model.status === "blocked") {
      rejected.push({ modelId: model.id, reason: "model_blocked" });
      return false;
    }
    return true;
  });

  const selectedModel = candidates.sort((a, b) => {
    if (input.performanceMode === "fast") return a.estimatedRamGb - b.estimatedRamGb;
    if (input.performanceMode === "performance") return b.recommendedDeviceTier - a.recommendedDeviceTier;
    return Math.abs(a.recommendedDeviceTier - input.deviceTier) - Math.abs(b.recommendedDeviceTier - input.deviceTier);
  })[0] ?? null;

  return {
    selectedModel,
    rejected,
    reasonCode: selectedModel ? "best_task_fit_for_device_tier" : "no_compatible_model",
  };
}

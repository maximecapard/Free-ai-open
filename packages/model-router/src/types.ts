import type { DeviceProfile } from "@free-ai-open/device-profiler";
import type { Backend, DeviceTier, PerformanceMode, TaskCategory } from "@free-ai-open/types";
import type { ModelRecord } from "@free-ai-open/model-registry";

export type RejectionReason = "model_blocked" | "task_not_supported" | "device_tier_too_low" | "backend_not_available";

export type ModelDecisionReasonCode = "recommended_model_selected" | "no_compatible_model";

export interface ModelRouterInput {
  task: TaskCategory;
  performanceMode: PerformanceMode;
  deviceProfile: DeviceProfile;
  modelRegistry: readonly ModelRecord[];
}

export interface RejectedModel {
  modelId: string;
  reason: RejectionReason;
}

export interface CompatibilityResult {
  compatibleModels: ModelRecord[];
  rejectedModels: RejectedModel[];
}

export interface ModelDecisionExplanation {
  reasonCode: ModelDecisionReasonCode;
  humanReadableReason: string;
}

export interface ModelRouterResult extends ModelDecisionExplanation {
  selectedModel: ModelRecord | null;
  fallbackModel: ModelRecord | null;
  rejectedModels: RejectedModel[];
}

export interface RouteModelInput {
  task: TaskCategory;
  performanceMode: PerformanceMode;
  deviceTier: DeviceTier;
  models: readonly ModelRecord[];
  availableBackends?: readonly Backend[];
}

export interface RouteModelResult extends ModelRouterResult {
  rejected: RejectedModel[];
}

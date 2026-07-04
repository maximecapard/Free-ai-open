import type { ModelRecord } from "@free-ai-open/model-registry";
import type { ModelDecisionExplanation, ModelRouterInput, RejectedModel } from "./types";

export function explainModelDecision(
  input: ModelRouterInput,
  selectedModel: ModelRecord | null,
  fallbackModel: ModelRecord | null,
  rejectedModels: readonly RejectedModel[]
): ModelDecisionExplanation {
  if (!selectedModel) {
    return {
      reasonCode: "no_compatible_model",
      humanReadableReason: `No compatible model is available for ${input.task} on device tier ${input.deviceProfile.deviceTier}. ${rejectedModels.length} model(s) were rejected by compatibility checks.`,
    };
  }

  const fallbackText = fallbackModel ? ` Fallback model: ${fallbackModel.displayName}.` : " No fallback model is currently available.";

  return {
    reasonCode: "recommended_model_selected",
    humanReadableReason: `Selected ${selectedModel.displayName} for ${input.task} in ${input.performanceMode} mode on device tier ${input.deviceProfile.deviceTier}.${fallbackText}`,
  };
}

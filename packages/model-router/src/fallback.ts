import type { ModelRecord } from "@free-ai-open/model-registry";
import { rejectIncompatibleModels } from "./compatibility";
import { rankCompatibleModels } from "./scoring";
import type { ModelRouterInput } from "./types";

export function getFallbackModel(
  input: ModelRouterInput,
  rankedModels: readonly ModelRecord[] = rankCompatibleModels(input, rejectIncompatibleModels(input).compatibleModels),
  selectedModel: ModelRecord | null = rankedModels[0] ?? null
): ModelRecord | null {
  if (!selectedModel) {
    return null;
  }

  return rankedModels.find((model) => model.id !== selectedModel.id) ?? null;
}

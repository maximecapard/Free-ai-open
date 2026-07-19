import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { TranslationKey } from "../_i18n/dictionary";

const MODEL_NAME_KEYS: Record<string, TranslationKey> = {
  "smollm2-360m-instruct-q4f32": "modelNames.compact",
  "qwen3-0.6b-q4f16": "modelNames.lightMultilingual",
  "qwen3-1.7b-q4f16": "modelNames.balancedMultilingual",
  "qwen2.5-coder-1.5b-q4f16": "modelNames.codingFocused",
  "qwen3-4b-q4f16": "modelNames.performance",
};

export function localizedModelName(
  record: Pick<ModelRegistryRecord, "id" | "displayName">,
  translate: (key: TranslationKey) => string
): string {
  const key = MODEL_NAME_KEYS[record.id];
  return key ? translate(key) : record.displayName;
}

export function hasLocalizedModelName(modelId: string): boolean {
  return MODEL_NAME_KEYS[modelId] !== undefined;
}

import type { RuntimeErrorCode } from "@free-ai-open/ai-runtime";
import type { TranslationKey } from "../_i18n/dictionary";

export function runtimeErrorKey(code: RuntimeErrorCode): TranslationKey {
  return `runtimeError.${code}` as TranslationKey;
}

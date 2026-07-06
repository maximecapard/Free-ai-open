import type { GenerationStopReason, RuntimeErrorCode } from "@free-ai-open/ai-runtime";
import type { TranslationKey } from "../_i18n/dictionary";

export type GenerationNoticeKey =
  | "storageNotice.generationStopped"
  | "storageNotice.generationUnstable"
  | "storageNotice.generationTimedOut"
  | "storageNotice.generationFailed";

export function shouldPersistAssistantOutput(reason: GenerationStopReason | null, output: string): boolean {
  return reason === "completed" && output.length > 0;
}

export function shouldDiscardPartialAssistantOutput(
  reason: GenerationStopReason | null,
  errorCode?: RuntimeErrorCode
): boolean {
  if (reason === "cancelled" || reason === "degenerate_output") return true;
  return errorCode !== undefined;
}

export function generationNoticeKey(
  reason: GenerationStopReason | null,
  errorCode?: RuntimeErrorCode
): TranslationKey | null {
  if (reason === "cancelled" || errorCode === "generation_interrupted" || errorCode === "cancel_timeout") {
    return "storageNotice.generationStopped";
  }

  if (reason === "degenerate_output" || errorCode === "degenerate_output") {
    return "storageNotice.generationUnstable";
  }

  if (errorCode === "generation_stalled" || errorCode === "generation_timeout") {
    return "storageNotice.generationTimedOut";
  }

  if (errorCode) return "storageNotice.generationFailed";
  return null;
}

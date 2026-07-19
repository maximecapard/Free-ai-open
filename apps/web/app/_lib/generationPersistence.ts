import type { GenerationStopReason, RuntimeErrorCode } from "@free-ai-open/ai-runtime";
import type { TranslationKey } from "../_i18n/dictionary";

export type GenerationNoticeKey =
  | "storageNotice.generationStopped"
  | "storageNotice.generationUnstable"
  | "storageNotice.generationTimedOut"
  | "storageNotice.generationIncomplete"
  | "storageNotice.generationFailed";

// The two watchdog outcomes that represent "the model stopped responding"
// rather than a hard failure — see packages/ai-runtime/src/runtime.ts. Both
// are eligible to preserve whatever partial output already streamed instead
// of discarding it, since the reply was genuinely interrupted mid-flight
// rather than actively broken.
const INTERRUPTIBLE_WATCHDOG_CODES = new Set<RuntimeErrorCode | undefined>([
  "generation_stalled",
  "generation_exceeded_safety_limit",
]);

export function shouldPersistAssistantOutput(reason: GenerationStopReason | null, output: string): boolean {
  return reason === "completed" && output.length > 0;
}

// hasPartialOutput reflects whether any assistant text had already streamed
// before the interruption. A genuine stall/safety-limit interruption with
// visible partial output is preserved (see docs/architecture.md's watchdog
// section); every other case — including a stall/safety-limit that produced
// no output at all — keeps the existing discard behavior.
export function shouldDiscardPartialAssistantOutput(
  reason: GenerationStopReason | null,
  errorCode?: RuntimeErrorCode,
  hasPartialOutput = false
): boolean {
  if (reason === "cancelled" || reason === "degenerate_output") return true;
  if (INTERRUPTIBLE_WATCHDOG_CODES.has(errorCode)) return !hasPartialOutput;
  return errorCode !== undefined;
}

export function generationNoticeKey(
  reason: GenerationStopReason | null,
  errorCode?: RuntimeErrorCode,
  hasPartialOutput = false
): TranslationKey | null {
  if (reason === "cancelled" || errorCode === "generation_interrupted" || errorCode === "cancel_timeout") {
    return "storageNotice.generationStopped";
  }

  if (reason === "degenerate_output" || errorCode === "degenerate_output") {
    return "storageNotice.generationUnstable";
  }

  if (INTERRUPTIBLE_WATCHDOG_CODES.has(errorCode)) {
    return hasPartialOutput ? "storageNotice.generationIncomplete" : "storageNotice.generationTimedOut";
  }

  if (errorCode) return "storageNotice.generationFailed";
  return null;
}

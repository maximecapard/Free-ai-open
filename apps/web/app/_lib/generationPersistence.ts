import type { GenerationStopReason, RuntimeErrorCode } from "@free-ai-open/ai-runtime";
import type { MessageIncompleteReason } from "@free-ai-open/conversation-store";
import type { TranslationKey } from "../_i18n/dictionary";

export type GenerationNoticeKey =
  | "storageNotice.generationStopped"
  | "storageNotice.generationUnstable"
  | "storageNotice.generationTimedOut"
  | "storageNotice.generationIncomplete"
  | "storageNotice.generationSafetyLimit"
  | "storageNotice.generationSafetyLimitIncomplete"
  | "storageNotice.generationLengthLimited"
  | "storageNotice.generationUnknownIncomplete"
  | "storageNotice.generationUnsupportedFeature"
  | "storageNotice.generationFailed";

// The two watchdog outcomes that represent "the model stopped responding"
// rather than a hard failure -- see packages/ai-runtime/src/runtime.ts. Both
// are eligible to preserve whatever partial output already streamed instead
// of discarding it, since the reply was genuinely interrupted mid-flight
// rather than actively broken.
const INTERRUPTIBLE_WATCHDOG_CODES = new Set<RuntimeErrorCode | undefined>([
  "generation_stalled",
  "generation_exceeded_safety_limit",
]);

// Stop reasons where the model (or the runtime, for "unknown_terminal")
// produced something other than a clean, confirmed natural stop, but where
// discarding any partial output outright would throw away legitimate
// content -- see packages/ai-runtime/src/types.ts's GenerationStopReason
// doc comment for what each one means. None of these are ever folded into
// "completed", and none are ever treated as a hard runtime failure.
const AMBIGUOUS_TERMINAL_REASONS = new Set<GenerationStopReason | null>([
  "length",
  "unsupported_tool_call",
  "unknown_terminal",
]);

// A generation can be genuinely interrupted -- leaving partial output worth
// preserving -- for either an ambiguous terminal reason above or a
// watchdog-forced RuntimeError (see INTERRUPTIBLE_WATCHDOG_CODES). Neither
// is a stall, a runtime failure, or a normal complete answer -- both are
// surfaced as an explicit interruption with the partial output preserved
// rather than silently discarded or silently accepted as a successful
// reply.
export function isIncompleteAssistantOutput(
  reason: GenerationStopReason | null,
  errorCode?: RuntimeErrorCode,
  hasPartialOutput = false
): boolean {
  if (!hasPartialOutput) return false;
  return AMBIGUOUS_TERMINAL_REASONS.has(reason) || INTERRUPTIBLE_WATCHDOG_CODES.has(errorCode);
}

export function shouldPersistAssistantOutput(
  reason: GenerationStopReason | null,
  output: string,
  errorCode?: RuntimeErrorCode
): boolean {
  return output.length > 0 && (reason === "completed" || isIncompleteAssistantOutput(reason, errorCode, true));
}

// hasPartialOutput reflects whether any assistant text had already streamed
// before the interruption. A genuine stall/safety-limit/ambiguous-terminal
// interruption with visible partial output is preserved (see
// docs/architecture.md's watchdog and reasoning sections); every other case
// -- including one of those that somehow produced no output at all -- keeps
// the existing discard behavior.
export function shouldDiscardPartialAssistantOutput(
  reason: GenerationStopReason | null,
  errorCode?: RuntimeErrorCode,
  hasPartialOutput = false
): boolean {
  if (reason === "cancelled" || reason === "degenerate_output") return true;
  if (AMBIGUOUS_TERMINAL_REASONS.has(reason)) return !hasPartialOutput;
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

  if (reason === "length") {
    return "storageNotice.generationLengthLimited";
  }

  if (reason === "unsupported_tool_call") {
    return "storageNotice.generationUnsupportedFeature";
  }

  if (reason === "unknown_terminal") {
    // Fails closed but stays quiet when there is nothing to explain: no
    // output was produced and no RuntimeError was raised, so there is
    // nothing concrete to tell the user beyond silently not saving an
    // empty reply (matching a first-token timeout with no output).
    return hasPartialOutput ? "storageNotice.generationUnknownIncomplete" : null;
  }

  if (errorCode === "generation_stalled") {
    return hasPartialOutput ? "storageNotice.generationIncomplete" : "storageNotice.generationTimedOut";
  }

  if (errorCode === "generation_exceeded_safety_limit") {
    return hasPartialOutput
      ? "storageNotice.generationSafetyLimitIncomplete"
      : "storageNotice.generationSafetyLimit";
  }

  if (errorCode) return "storageNotice.generationFailed";
  return null;
}

// Maps a generation's outcome to the durable, persisted reason a message is
// incomplete (see @free-ai-open/conversation-store's MessageIncompleteReason
// -- this is what lets a length-limited reply still show its specific "La
// limite de génération a été atteinte." notice after a reload, instead of
// falling back to the generic one). Returns undefined for a normal complete
// reply or a discarded/cancelled one, since neither is ever persisted as
// "incomplete" in the first place.
export function incompleteReasonFor(
  reason: GenerationStopReason | null,
  errorCode?: RuntimeErrorCode
): MessageIncompleteReason | undefined {
  if (reason === "length") return "length";
  if (reason === "unsupported_tool_call") return "unsupported_tool_call";
  if (reason === "unknown_terminal") return "unknown_terminal";
  if (errorCode === "generation_stalled") return "stalled";
  if (errorCode === "generation_exceeded_safety_limit") return "safety_limit";
  return undefined;
}

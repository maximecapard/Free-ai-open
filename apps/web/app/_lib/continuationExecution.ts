import { updateMessageContent } from "@free-ai-open/conversation-store";
import type { ConversationId, MessageIncompleteReason, MessageStatus } from "@free-ai-open/conversation-store";
import type { GenerationStopReason, InferenceRuntime, RuntimeErrorCode, RuntimeLocale } from "@free-ai-open/ai-runtime";
import type { TranslationKey } from "../_i18n/dictionary";
import { mergeContinuationOverlap } from "./continuationMerge";
import { generationNoticeKey, incompleteReasonFor, isIncompleteAssistantOutput } from "./generationPersistence";

export interface ContinuationAttemptInput {
  runtime: Pick<InferenceRuntime, "generate">;
  conversationId: ConversationId;
  assistantMessageId: string;
  // Exactly what the message contained immediately before this attempt --
  // the transactional rollback point on Stop/degenerate output.
  priorContent: string;
  priorStatus: MessageStatus | undefined;
  priorIncompleteReason: MessageIncompleteReason | undefined;
  // Already durably persisted (by the caller) before this attempt started --
  // see AppRuntimeProvider.tsx's continueGeneration(), which bumps and
  // saves this BEFORE calling runContinuationAttempt() at all, so the
  // attempt counts as used even if the generation itself never completes.
  nextContinuationCount: number;
  continuationPrompt: string;
  responseLocale: RuntimeLocale;
  maxOutputTokens: number | undefined;
  // Called synchronously on every raw chunk with the accumulator's current
  // merged content, so a caller (AppRuntimeProvider.tsx) can reflect live
  // streaming progress into UI state as it happens. Optional -- a test that
  // only cares about the final persisted outcome can omit it.
  onProgress?: (mergedContent: string) => void;
  // Lets a caller detect that a newer generation has superseded this one
  // (e.g. the user navigated away and started a fresh message) and abandon
  // this attempt without persisting a stale result. Checked before
  // processing each chunk; defaults to "always current" for callers (like
  // tests) that only ever run one attempt at a time.
  isStillCurrent?: () => boolean;
}

export type ContinuationAttemptOutcome =
  | {
      kind: "reverted";
      finalContent: string;
      status: MessageStatus | undefined;
      incompleteReason: MessageIncompleteReason | undefined;
      stopReason: GenerationStopReason | null;
      noticeKey: TranslationKey | null;
      persisted: boolean;
    }
  | {
      kind: "persisted";
      finalContent: string;
      status: MessageStatus;
      incompleteReason: MessageIncompleteReason | undefined;
      stopReason: GenerationStopReason | null;
      errorCode: RuntimeErrorCode | undefined;
      noticeKey: TranslationKey | null;
      truncated: boolean;
      persisted: boolean;
    }
  | { kind: "abandoned" };

// Runs exactly one Continue attempt against an InferenceRuntime and
// persists its outcome through @free-ai-open/conversation-store -- the
// exact orchestration AppRuntimeProvider.tsx's continueGeneration()
// performs, extracted into a plain async function so it can be exercised
// directly in a test without mounting React (this repo's default test
// environment has no DOM). The caller receives the final content/status/
// incompleteReason as this function's RETURN VALUE, computed and captured
// entirely before returning -- there is no shared mutable ref a caller
// could clear before reading it, which is exactly the ordering mistake a
// prior version of continueGeneration() made (calling cleanup before
// reading the generation accumulator, so a successful continuation
// silently fell back to priorContent and discarded everything it just
// generated). See continuationExecution.test.ts's dedicated regression
// test for this.
export async function runContinuationAttempt(input: ContinuationAttemptInput): Promise<ContinuationAttemptOutcome> {
  const isStillCurrent = input.isStillCurrent ?? (() => true);
  let generatedDelta = "";
  let mergedContent = input.priorContent;
  let stopReason: GenerationStopReason | null = null;
  let runtimeErrorCode: RuntimeErrorCode | undefined;

  for await (const chunk of input.runtime.generate({
    conversationId: input.conversationId,
    prompt: input.continuationPrompt,
    responseLocale: input.responseLocale,
    maxOutputTokens: input.maxOutputTokens,
  })) {
    if (!isStillCurrent()) return { kind: "abandoned" };

    if (chunk.type === "token") {
      generatedDelta += chunk.text;
      mergedContent = mergeContinuationOverlap(input.priorContent, generatedDelta);
      input.onProgress?.(mergedContent);
    } else if (chunk.type === "done") {
      stopReason = chunk.reason;
    } else if (chunk.type === "error") {
      runtimeErrorCode = chunk.error.code;
      break;
    }
  }

  if (!isStillCurrent()) return { kind: "abandoned" };

  if (stopReason === "cancelled" || stopReason === "degenerate_output") {
    // This attempt's own output isn't trustworthy or wanted (a user Stop,
    // or the model produced degenerate output) -- revert to the pre-
    // continuation content/status instead of keeping whatever partial text
    // streamed this round. The message itself is never removed (unlike a
    // fresh sendMessage()'s discard path), since it already held a
    // legitimate prior answer before this continuation began.
    const noticeKey: TranslationKey | null =
      stopReason === "cancelled" ? "storageNotice.generationStoppedRecovering" : generationNoticeKey(stopReason, runtimeErrorCode);
    const saved = await updateMessageContent(input.conversationId, input.assistantMessageId, {
      content: input.priorContent,
      status: input.priorStatus,
      // A genuinely absent prior reason must be explicitly cleared
      // (`null`), not left as whatever the caller's earlier continuation-
      // count-only bump wrote.
      incompleteReason: input.priorIncompleteReason ?? null,
      continuationCount: input.nextContinuationCount,
    });
    return {
      kind: "reverted",
      finalContent: input.priorContent,
      status: input.priorStatus,
      incompleteReason: input.priorIncompleteReason,
      stopReason,
      noticeKey,
      persisted: Boolean(saved),
    };
  }

  // The message already held partial output before this attempt started,
  // so -- unlike a fresh sendMessage() -- "not currently complete" always
  // means "still incomplete", never "empty".
  const isIncompleteOutput = isIncompleteAssistantOutput(stopReason, runtimeErrorCode, true);
  const status: MessageStatus = isIncompleteOutput ? "incomplete" : "complete";
  const incompleteReason = isIncompleteOutput ? incompleteReasonFor(stopReason, runtimeErrorCode) : undefined;
  const noticeKey = generationNoticeKey(stopReason, runtimeErrorCode, true);

  const saved = await updateMessageContent(input.conversationId, input.assistantMessageId, {
    content: mergedContent,
    status,
    // A successful completion must CLEAR any stale incompleteReason the
    // message had before this continuation (e.g. "length" from the
    // interruption Continue was fixing) -- see UpdateMessageContentInput's
    // three-way patch semantics in @free-ai-open/conversation-store.
    incompleteReason: incompleteReason ?? null,
    continuationCount: input.nextContinuationCount,
  });

  // Item 4 (second-round review): when the store had to truncate,
  // mergedContent/status/incompleteReason computed above are no longer
  // what is actually stored -- the store's own normalized message is
  // authoritative. Adopting it here (rather than a second, UI-side
  // normalization) means the caller's setMessages() can never diverge
  // from what a reload of IndexedDB would show.
  const savedMessage = saved?.conversation.messages.find((message) => message.id === input.assistantMessageId);

  return {
    kind: "persisted",
    finalContent: savedMessage ? savedMessage.content : mergedContent,
    status: savedMessage ? (savedMessage.status ?? status) : status,
    incompleteReason: savedMessage ? savedMessage.incompleteReason : incompleteReason,
    stopReason,
    errorCode: runtimeErrorCode,
    noticeKey,
    truncated: saved?.truncated ?? false,
    persisted: Boolean(saved),
  };
}

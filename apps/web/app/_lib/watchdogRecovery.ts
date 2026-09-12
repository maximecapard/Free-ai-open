import { addMessage, updateMessageContent } from "@free-ai-open/conversation-store";
import type { ConversationId, MessageIncompleteReason, MessageStatus } from "@free-ai-open/conversation-store";
import type { RuntimeErrorCode } from "@free-ai-open/ai-runtime";
import type { TranslationKey } from "../_i18n/dictionary";
import { generationNoticeKey, incompleteReasonFor, shouldDiscardPartialAssistantOutput } from "./generationPersistence";

export interface WatchdogRecoveryInput {
  conversationId: ConversationId;
  assistantMessageId: string;
  errorCode: RuntimeErrorCode;
  isContinuation: boolean;
  // Only meaningful when isContinuation is true -- the exact pre-
  // continuation state to transactionally revert to on cancel_timeout.
  priorContent: string;
  priorStatus: MessageStatus | undefined;
  priorIncompleteReason: MessageIncompleteReason | undefined;
  priorContinuationCount: number;
  // The generation accumulator's current merged content at the moment the
  // watchdog fired (or the best-effort fallback read of React state if the
  // accumulator was somehow unavailable).
  currentContent: string;
  // Whether this attempt produced any new output at all -- only used for a
  // FRESH send's hasPartialOutput decision (a continuation already has
  // hasPartialOutput = true unconditionally, since it always holds a prior
  // legitimate answer).
  hasNewOutput: boolean;
}

export type WatchdogRecoveryOutcome = {
  messageUpdate:
    | { op: "remove" }
    | { op: "set"; content: string; status: MessageStatus | undefined; incompleteReason: MessageIncompleteReason | undefined };
  noticeKey: TranslationKey | null;
  // cancel_timeout always needs a full runtime recovery (the worker/engine
  // itself is not trustworthy after that specific failure); every other
  // watchdog code just needs the router re-evaluated.
  recoveryAction: "recover_runtime" | "refresh_routing";
  // Only meaningful when messageUpdate.op is "set" -- whether the
  // persistence write actually succeeded, and whether it had to truncate.
  persisted: boolean;
  truncated: boolean;
};

// Runs the persistence side of the out-of-band watchdog-error fallback path
// in AppRuntimeProvider.tsx -- the case where a forced-recovery error
// (cancel_timeout, generation_stalled, generation_exceeded_safety_limit)
// fires because generate()'s stream never delivered its own terminal chunk
// (see runtime.ts's forceRecovery()). Extracted into a plain async function,
// independent of React state, so it can be exercised directly in a test
// without mounting a component (this repo's default test environment has no
// DOM) -- see watchdogRecovery.test.ts's cancel_timeout-during-Continue and
// recovery-failure-during-Continue regression tests.
export async function runWatchdogRecovery(input: WatchdogRecoveryInput): Promise<WatchdogRecoveryOutcome> {
  const recoveryAction: WatchdogRecoveryOutcome["recoveryAction"] =
    input.errorCode === "cancel_timeout" ? "recover_runtime" : "refresh_routing";

  if (input.errorCode === "cancel_timeout" && input.isContinuation) {
    // Transactional rollback: cancel_timeout means this attempt's runtime
    // state is not trustworthy -- revert to exactly the pre-continuation
    // content/status/reason instead of deleting the message (it already
    // held a legitimate prior answer) or keeping possibly-corrupted output.
    const saved = await updateMessageContent(input.conversationId, input.assistantMessageId, {
      content: input.priorContent,
      status: input.priorStatus,
      // A genuinely absent prior reason must be explicitly cleared, not
      // left as whatever an earlier continuation-count-only bump wrote.
      incompleteReason: input.priorIncompleteReason ?? null,
      continuationCount: input.priorContinuationCount,
    });
    return {
      messageUpdate: {
        op: "set",
        content: input.priorContent,
        status: input.priorStatus,
        incompleteReason: input.priorIncompleteReason,
      },
      noticeKey: "storageNotice.generationStoppedRecovering",
      recoveryAction,
      persisted: Boolean(saved),
      truncated: false,
    };
  }

  const hasPartialOutput = input.isContinuation || input.hasNewOutput;
  const noticeKey = generationNoticeKey(null, input.errorCode, hasPartialOutput);

  if (!input.isContinuation && shouldDiscardPartialAssistantOutput(null, input.errorCode, hasPartialOutput)) {
    return { messageUpdate: { op: "remove" }, noticeKey, recoveryAction, persisted: false, truncated: false };
  }

  // A genuine stall/safety-limit interruption that already produced (or, for
  // a continuation, already held) visible output: keep it, mark it
  // incomplete with the matching durable reason, and persist via
  // updateMessageContent for a continuation (extending the existing
  // message) or addMessage for a fresh reply (never persisted yet).
  const nextIncompleteReason = incompleteReasonFor(null, input.errorCode);
  const saved = input.isContinuation
    ? await updateMessageContent(input.conversationId, input.assistantMessageId, {
        content: input.currentContent,
        status: "incomplete",
        incompleteReason: nextIncompleteReason ?? null,
      })
    : await addMessage(input.conversationId, {
        id: input.assistantMessageId,
        role: "assistant",
        content: input.currentContent,
        status: "incomplete",
        incompleteReason: nextIncompleteReason,
      });

  // Item 4 (second-round review): when the store had to truncate
  // input.currentContent, its own normalized message is authoritative --
  // adopt content/status/incompleteReason from it exactly rather than the
  // pre-truncation local values, so the caller's setMessages() can never
  // diverge from what a reload of IndexedDB would show. A genuine
  // truncation forces incompleteReason to "truncated" regardless of the
  // more specific reason (e.g. "stalled") this function itself computed,
  // since the store's own reason is the more accurate one once it actually
  // had to clamp the content.
  const savedMessage = saved?.conversation.messages.find((message) => message.id === input.assistantMessageId);

  return {
    messageUpdate: {
      op: "set",
      content: savedMessage ? savedMessage.content : input.currentContent,
      status: savedMessage ? (savedMessage.status ?? "incomplete") : "incomplete",
      incompleteReason: savedMessage ? savedMessage.incompleteReason : nextIncompleteReason,
    },
    noticeKey,
    recoveryAction,
    persisted: Boolean(saved),
    truncated: saved?.truncated ?? false,
  };
}

export interface RecoveryActionResult {
  // Whether the requested recovery action actually completed successfully.
  // For "refresh_routing" this is always true (there is no failure concept
  // for a plain re-evaluation). For "recover_runtime" it reflects
  // recoverRuntime()'s own resolved boolean, OR false if the call rejected
  // outright -- e.g. an exception escaping deep inside initializeRuntime()
  // (routing/candidate resolution runs outside its own try/catch) before it
  // ever settles its own boolean. Never throws itself.
  recoverySucceeded: boolean;
}

// Executes the recovery action a WatchdogRecoveryOutcome calls for and
// reports whether it actually succeeded, instead of the previous
// fire-and-forget `void recoverRuntime()` in AppRuntimeProvider.tsx, which
// discarded the result entirely and would have left an unhandled promise
// rejection with zero user-visible signal if recoverRuntime() ever
// rejected. Extracted as its own small function (independent of
// runWatchdogRecovery()'s persistence decision above, which already
// completes -- reverting or preserving the message -- before this is ever
// called) specifically so recoverRuntime() failing can be exercised
// directly in a test with a mock, without a real runtime or a 15-second
// timeout -- see watchdogRecovery.test.ts's "recoverRuntime() rejects"/
// "recoverRuntime() resolves false" regression tests.
export async function runRecoveryAction(
  recoveryAction: WatchdogRecoveryOutcome["recoveryAction"],
  deps: {
    recoverRuntime: () => Promise<boolean>;
    refreshRoutingDecision: () => Promise<void> | void;
  }
): Promise<RecoveryActionResult> {
  if (recoveryAction === "refresh_routing") {
    await deps.refreshRoutingDecision();
    return { recoverySucceeded: true };
  }

  try {
    const succeeded = await deps.recoverRuntime();
    return { recoverySucceeded: succeeded };
  } catch {
    return { recoverySucceeded: false };
  }
}

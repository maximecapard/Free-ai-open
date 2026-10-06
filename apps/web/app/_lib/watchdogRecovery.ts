import { addMessage, updateMessageContent } from "@free-ai-open/conversation-store";
import type { ConversationId, MessageIncompleteReason, MessageStatus } from "@free-ai-open/conversation-store";
import { normalizeRuntimeRecoveryResult } from "@free-ai-open/ai-runtime";
import type { RuntimeErrorCode, RuntimeOperationLease, RuntimeRecoveryResult } from "@free-ai-open/ai-runtime";
import type { TranslationKey } from "../_i18n/dictionary";
import type { GenerationLeaseHandle } from "./generationLeaseOwnership";
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

// How long a watchdog code that does not itself need a runtime recycle
// ("refresh_routing": a stall/safety-limit) waits for the interrupted
// generation's owner to finish and release its lease on its own before the
// recovery concludes the stream is non-cooperative and takes the lease over.
// cancel_timeout never waits: the engine did not confirm interruption at all.
export const WATCHDOG_OWNER_RELEASE_GRACE_MS = 5_000;

export interface RecoveryActionResult {
  // The runtime recovery this action performed, reported as two INDEPENDENT
  // facts (see RuntimeRecoveryResult): whether the previous operation/domain
  // is quiescent/isolated, and whether the runtime is usable again. `null`
  // when the action did not touch the runtime at all (a plain routing
  // refresh after the interrupted generation's owner finished by itself).
  // Never a single "success" boolean: isolated=true, ready=false means the
  // lease was safely released but nothing is usable yet, whereas
  // isolated=false means ownership was NOT handed back.
  recovery: RuntimeRecoveryResult | null;
}

// What the routing refresh that follows a stall recovery achieved. It is an
// explicit value, never inferred from side effects: a refresh that replaced the
// runtime reports that replacement's own two facts, one that replaced nothing
// reports null, and one that threw is `failed`.
export type RoutingRefreshOutcome =
  | { kind: "completed"; replacement: RuntimeRecoveryResult | null }
  | { kind: "failed" };

// Folds the routing refresh into the recovery result so that NO path can
// report ready=true unless the runtime intended for continued use is
// genuinely ready:
//
//   final.ready = isolated
//                 AND the replacement (if any) initialized successfully
//                 AND the runtime actually reports "ready" right now
//
// - refresh replaced the runtime: its own {isolated, ready} supersede the
//   earlier recovery's readiness (the runtime that will be used is the
//   replacement), and isolation must hold for BOTH the recovery and the
//   replacement -- a refresh that leaves isolation unproven makes the whole
//   outcome {isolated: false, ready: false} (and its quarantine stands);
// - refresh replaced nothing: the recovery's own result stands, still subject
//   to the live readiness check;
// - refresh failed: never an earlier success -- ready=false (isolation is
//   whatever recovery already proved). With no recovery at all nothing was
//   touched, so the live readiness decides: a runtime that is still ready
//   reports nothing, one that is not reports {isolated: true, ready: false}.
// Returns null only when neither a recovery nor a replacement happened.
export function combineRecoveryWithRefresh(
  recovery: RuntimeRecoveryResult | null,
  refresh: RoutingRefreshOutcome,
  isRuntimeReady?: () => boolean
): RuntimeRecoveryResult | null {
  const runtimeReady = (): boolean => (isRuntimeReady ? isRuntimeReady() : true);

  if (refresh.kind === "failed") {
    if (recovery === null) return runtimeReady() ? null : { isolated: true, ready: false };
    return { isolated: recovery.isolated, ready: false };
  }
  const replacement = refresh.replacement === null ? null : normalizeRuntimeRecoveryResult(refresh.replacement);
  if (replacement === null) {
    if (recovery === null) return null;
    return { isolated: recovery.isolated, ready: recovery.isolated && recovery.ready && runtimeReady() };
  }
  const isolated = replacement.isolated && (recovery ? recovery.isolated : true);
  return { isolated, ready: isolated && replacement.ready && runtimeReady() };
}

export interface RecoveryActionDeps {
  // Recovers the runtime. When `lease` is supplied it MUST run under that
  // lease and never acquire a second one for the same logical operation.
  recoverRuntime: (lease?: RuntimeOperationLease) => Promise<RuntimeRecoveryResult>;
  // Re-routes after a stall recovery. Resolves with the outcome of any runtime
  // REPLACEMENT it performed (null when it performed none) so readiness is
  // propagated explicitly; a rejection is treated as a failed replacement.
  refreshRoutingDecision: () => Promise<RuntimeRecoveryResult | null>;
  // Whether the runtime intended for continued use reports "ready" right now.
  // When supplied, ready=true is never returned unless this agrees.
  isRuntimeReady?: () => boolean;
  // The generation-owner lease that is (or was) held while the watchdog
  // fired. When it is still current, recovery runs under it so a
  // non-cooperative stream can never wedge the lease forever.
  owner?: GenerationLeaseHandle | null;
  ownerReleaseGraceMs?: number;
}

async function safeRecover(recover: () => Promise<RuntimeRecoveryResult>): Promise<RuntimeRecoveryResult> {
  try {
    return normalizeRuntimeRecoveryResult(await recover());
  } catch {
    return { isolated: false, ready: false };
  }
}

// Executes the recovery action a WatchdogRecoveryOutcome calls for, honoring
// runtime ownership:
//
// - "recover_runtime" (cancel_timeout): runs the full recovery UNDER the
//   interrupted generation's own lease when it is still held, and never
//   asks the coordinator for a second lease for the same operation.
// - "refresh_routing" (stall / safety limit): first lets the generation's
//   owner finish and release by itself. Only if it does not within the grace
//   period (a non-cooperative stream) is the lease taken over and the
//   runtime recovered under it. The routing refresh -- which may replace the
//   model and therefore needs ownership of its own -- runs only AFTER the
//   lease is gone, so a refused ownership can never be reported as success.
//
// Never throws. See watchdogRecovery.test.ts and
// AppRuntimeProvider.watchdog.test.tsx.
export async function runRecoveryAction(
  recoveryAction: WatchdogRecoveryOutcome["recoveryAction"],
  deps: RecoveryActionDeps
): Promise<RecoveryActionResult> {
  const owner = deps.owner && deps.owner.isLeaseCurrent() ? deps.owner : null;
  const recoverUnder = (handle: GenerationLeaseHandle) =>
    handle.recoverUnderLease((lease) => deps.recoverRuntime(lease));
  // ready=true is only ever reported while the runtime really is ready.
  const withLiveReadiness = (result: RuntimeRecoveryResult): RuntimeRecoveryResult => ({
    isolated: result.isolated,
    ready: result.isolated && result.ready && (deps.isRuntimeReady ? deps.isRuntimeReady() : true),
  });

  if (recoveryAction === "recover_runtime") {
    if (owner) {
      const underOwnerLease = await recoverUnder(owner);
      if (underOwnerLease) return { recovery: withLiveReadiness(underOwnerLease) };
    }
    return { recovery: withLiveReadiness(await safeRecover(() => deps.recoverRuntime())) };
  }

  let recovery: RuntimeRecoveryResult | null = null;
  if (owner) {
    const ownerFinished = await owner.waitForSettlement(deps.ownerReleaseGraceMs ?? WATCHDOG_OWNER_RELEASE_GRACE_MS);
    if (!ownerFinished) recovery = await recoverUnder(owner);
  }
  // A recovery that could not prove isolation left the runtime QUARANTINED;
  // nothing -- including this automatic reroute -- touches it until an explicit
  // retry proves isolation.
  if (recovery && !recovery.isolated) return { recovery: withLiveReadiness(recovery) };

  let refresh: RoutingRefreshOutcome;
  try {
    refresh = { kind: "completed", replacement: await deps.refreshRoutingDecision() };
  } catch {
    refresh = { kind: "failed" };
  }
  return { recovery: combineRecoveryWithRefresh(recovery, refresh, deps.isRuntimeReady) };
}

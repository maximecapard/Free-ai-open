import { describe, expect, it } from "vitest";
import { addMessage, createConversation, getConversation } from "@free-ai-open/conversation-store";
import { createRuntimeOperationCoordinator } from "@free-ai-open/ai-runtime";
import type { RuntimeRecoveryResult } from "@free-ai-open/ai-runtime";
import { createGenerationLeaseHandle } from "./generationLeaseOwnership";
import { combineRecoveryWithRefresh, runRecoveryAction, runWatchdogRecovery } from "./watchdogRecovery";

describe("runWatchdogRecovery", () => {
  it("cancel_timeout during Continue: restores priorContent/status/incompleteReason exactly, keeps the original bubble, and requests a runtime recovery", async () => {
    const conversation = await createConversation({ title: "cancel_timeout during Continue" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    await addMessage(conversationId, {
      id: "assistant-1",
      role: "assistant",
      content: "Original answer that was interrupted before",
      status: "incomplete",
      incompleteReason: "length",
      continuationCount: 1,
    });

    const outcome = await runWatchdogRecovery({
      conversationId,
      assistantMessageId: "assistant-1",
      errorCode: "cancel_timeout",
      isContinuation: true,
      priorContent: "Original answer that was interrupted before",
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      priorContinuationCount: 1,
      currentContent: "Original answer that was interrupted before and some possibly-corrupt new text",
      hasNewOutput: true,
    });

    expect(outcome.messageUpdate).toEqual({
      op: "set",
      content: "Original answer that was interrupted before",
      status: "incomplete",
      incompleteReason: "length",
    });
    expect(outcome.recoveryAction).toBe("recover_runtime");
    expect(outcome.noticeKey).toBe("storageNotice.generationStoppedRecovering");
    expect(outcome.persisted).toBe(true);

    // The original bubble must survive -- never deleted -- and the store
    // must reflect the exact reverted content, not the possibly-corrupt
    // partial text that was streaming when the timeout fired.
    const reloaded = await getConversation(conversationId);
    const assistantMessages = reloaded?.messages.filter((m) => m.role === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("Original answer that was interrupted before");
    expect(assistantMessages[0]?.status).toBe("incomplete");
    expect(assistantMessages[0]?.incompleteReason).toBe("length");
    // continuationCount is restored to what it was durably persisted as
    // BEFORE this attempt (the caller passes priorContinuationCount, which
    // already reflects the attempt having been consumed at start time).
    expect(assistantMessages[0]?.continuationCount).toBe(1);
  });

  it("cancel_timeout during Continue clears a genuinely absent prior reason instead of leaving a stale one behind", async () => {
    const conversation = await createConversation({ title: "cancel_timeout no prior reason" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    // Simulates the early continuation-count-bump write already having run
    // (content/status unchanged, count bumped) before this attempt's own
    // stream got stuck -- the message itself never had a reason field.
    await addMessage(conversationId, { id: "assistant-1", role: "assistant", content: "Old historical reply", continuationCount: 1 });

    const outcome = await runWatchdogRecovery({
      conversationId,
      assistantMessageId: "assistant-1",
      errorCode: "cancel_timeout",
      isContinuation: true,
      priorContent: "Old historical reply",
      priorStatus: undefined,
      priorIncompleteReason: undefined,
      priorContinuationCount: 1,
      currentContent: "Old historical reply plus corrupt new text",
      hasNewOutput: true,
    });

    expect(outcome.persisted).toBe(true);
    const reloaded = await getConversation(conversationId);
    const message = reloaded?.messages.find((m) => m.id === "assistant-1");
    expect(message?.content).toBe("Old historical reply");
    expect(message?.incompleteReason).toBeUndefined();
  });

  it("persistence write failure during a cancel_timeout revert (Continue): the original message and its provenance survive even when the store write itself fails", async () => {
    // Renamed from "recovery failure during Continue" -- this test exercises
    // updateMessageContent() failing (a STORAGE write failure), not
    // recoverRuntime() failing (a RUNTIME recovery failure). See the
    // "runRecoveryAction" describe block below for the latter, which is
    // what item 2 of the second-round review actually asked for.
    // No conversation is created at all -- conversationId points nowhere,
    // so updateMessageContent() inside runWatchdogRecovery cannot find
    // anything to update and resolves to null, simulating a failed write
    // (e.g. a genuinely offline/broken store) without needing to fake the
    // store layer itself.
    const conversationId = "conversation-does-not-exist" as import("@free-ai-open/conversation-store").ConversationId;

    const outcome = await runWatchdogRecovery({
      conversationId,
      assistantMessageId: "assistant-1",
      errorCode: "cancel_timeout",
      isContinuation: true,
      priorContent: "Original answer",
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      priorContinuationCount: 1,
      currentContent: "Original answer plus new text",
      hasNewOutput: true,
    });

    // The function reports the write failed rather than throwing or
    // silently claiming success -- the caller (AppRuntimeProvider.tsx)
    // uses this to show storageNotice.couldNotSaveReply. Critically, the
    // returned messageUpdate is still "set" to the reverted prior state,
    // never "remove" -- a failed recovery write must never be treated as a
    // reason to delete the message.
    expect(outcome.persisted).toBe(false);
    expect(outcome.messageUpdate.op).toBe("set");
    if (outcome.messageUpdate.op === "set") {
      expect(outcome.messageUpdate.content).toBe("Original answer");
      expect(outcome.messageUpdate.status).toBe("incomplete");
      expect(outcome.messageUpdate.incompleteReason).toBe("length");
    }
    expect(outcome.recoveryAction).toBe("recover_runtime");
  });

  it("a genuine stall mid-continuation preserves the accumulated progress and marks it incomplete/stalled, extending the existing message", async () => {
    const conversation = await createConversation({ title: "stall during continuation" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    await addMessage(conversationId, { id: "assistant-1", role: "assistant", content: "Partial", status: "incomplete", incompleteReason: "length" });

    const outcome = await runWatchdogRecovery({
      conversationId,
      assistantMessageId: "assistant-1",
      errorCode: "generation_stalled",
      isContinuation: true,
      priorContent: "Partial",
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      priorContinuationCount: 1,
      currentContent: "Partial plus some more that streamed before it stalled",
      hasNewOutput: true,
    });

    expect(outcome.messageUpdate).toEqual({
      op: "set",
      content: "Partial plus some more that streamed before it stalled",
      status: "incomplete",
      incompleteReason: "stalled",
    });
    expect(outcome.recoveryAction).toBe("refresh_routing");

    const reloaded = await getConversation(conversationId);
    const message = reloaded?.messages.find((m) => m.id === "assistant-1");
    expect(message?.content).toBe("Partial plus some more that streamed before it stalled");
    expect(message?.incompleteReason).toBe("stalled");
  });

  it("a fresh (non-continuation) send with no output at all is discarded, never persisted", async () => {
    const outcome = await runWatchdogRecovery({
      conversationId: "conversation-1" as import("@free-ai-open/conversation-store").ConversationId,
      assistantMessageId: "assistant-1",
      errorCode: "generation_stalled",
      isContinuation: false,
      priorContent: "",
      priorStatus: undefined,
      priorIncompleteReason: undefined,
      priorContinuationCount: 0,
      currentContent: "",
      hasNewOutput: false,
    });

    expect(outcome.messageUpdate).toEqual({ op: "remove" });
    expect(outcome.noticeKey).toBe("storageNotice.generationTimedOut");
  });

  it("item 4 (mandatory): a genuine stall's preserved content that exceeds the storage ceiling adopts the exact truncated/normalized content the store actually persisted", async () => {
    const conversation = await createConversation({ title: "stall truncation sync" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    const priorContent = "a".repeat(60_000);
    await addMessage(conversationId, {
      id: "assistant-1",
      role: "assistant",
      content: priorContent,
      status: "incomplete",
      incompleteReason: "length",
    });

    const outcome = await runWatchdogRecovery({
      conversationId,
      assistantMessageId: "assistant-1",
      errorCode: "generation_stalled",
      isContinuation: true,
      priorContent,
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      priorContinuationCount: 1,
      // 10,000 more "b" characters pushes the total to 70,000, past the
      // store's 64,000-character ceiling.
      currentContent: `${priorContent}${"b".repeat(10_000)}`,
      hasNewOutput: true,
    });

    expect(outcome.truncated).toBe(true);
    expect(outcome.messageUpdate.op).toBe("set");
    if (outcome.messageUpdate.op === "set") {
      // The authoritative truncated content, not the 70,000-character
      // pre-truncation currentContent this function was given.
      expect(outcome.messageUpdate.content.length).toBe(64_000);
      expect(outcome.messageUpdate.status).toBe("incomplete");
    }

    const reloaded = await getConversation(conversationId);
    const message = reloaded?.messages.find((m) => m.id === "assistant-1");
    expect(message?.content).toBe(outcome.messageUpdate.op === "set" ? outcome.messageUpdate.content : undefined);
    expect(message?.content.length).toBe(64_000);
    expect(message?.status).toBe("incomplete");
    // A genuine truncation forces "truncated" as the reason -- the more
    // accurate one once the store actually had to clamp the content --
    // superseding the "stalled" reason this function itself would
    // otherwise have chosen; outcome.messageUpdate.incompleteReason above
    // must match this exactly, not the pre-truncation "stalled" value.
    expect(message?.incompleteReason).toBe("truncated");
    expect(outcome.messageUpdate.op === "set" ? outcome.messageUpdate.incompleteReason : undefined).toBe("truncated");
  });

  it("a fresh (non-continuation) send that already produced visible output is preserved via addMessage, never addressed via updateMessageContent", async () => {
    const conversation = await createConversation({ title: "fresh stall with output" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    // No assistant message exists yet -- a fresh send's placeholder was
    // never persisted before this watchdog interruption fired.

    const outcome = await runWatchdogRecovery({
      conversationId,
      assistantMessageId: "assistant-1",
      errorCode: "generation_stalled",
      isContinuation: false,
      priorContent: "",
      priorStatus: undefined,
      priorIncompleteReason: undefined,
      priorContinuationCount: 0,
      currentContent: "Some real partial output",
      hasNewOutput: true,
    });

    expect(outcome.persisted).toBe(true);
    const reloaded = await getConversation(conversationId);
    const message = reloaded?.messages.find((m) => m.id === "assistant-1");
    expect(message?.content).toBe("Some real partial output");
    expect(message?.status).toBe("incomplete");
    expect(message?.incompleteReason).toBe("stalled");
  });
});

// Item 2 (second-round review): the previous "recovery failure during
// Continue" test above did not actually simulate recoverRuntime() failing
// -- it simulated a persistence write failure instead. recoverRuntime()
// itself lives in useAdaptiveRuntimeRouting.ts and is injected into
// AppRuntimeProvider.tsx's watchdog effect; runRecoveryAction() is the
// small, focused seam that makes calling it (and reacting to it failing)
// directly testable, independent of React/the runtime lifecycle -- see
// watchdogRecovery.ts's own doc comment.
describe("runRecoveryAction", () => {
  it("Continue -> cancel_timeout -> revert -> recoverRuntime() REJECTS: the reverted message survives fully intact regardless, and the failure is reported rather than thrown", async () => {
    const conversation = await createConversation({ title: "recoverRuntime rejects during Continue" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    await addMessage(conversationId, {
      id: "assistant-1",
      role: "assistant",
      content: "Original answer that was interrupted before",
      status: "incomplete",
      incompleteReason: "length",
      continuationCount: 1,
    });

    // Step 1: the exact same transactional revert as "cancel_timeout during
    // Continue" above -- this completes and persists BEFORE recovery is
    // ever attempted, so the message's fate never depends on what happens
    // to the runtime afterward.
    const outcome = await runWatchdogRecovery({
      conversationId,
      assistantMessageId: "assistant-1",
      errorCode: "cancel_timeout",
      isContinuation: true,
      priorContent: "Original answer that was interrupted before",
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      priorContinuationCount: 1,
      currentContent: "Original answer that was interrupted before and some possibly-corrupt new text",
      hasNewOutput: true,
    });
    expect(outcome.persisted).toBe(true);
    expect(outcome.recoveryAction).toBe("recover_runtime");

    // Step 2: recoverRuntime() rejects outright (e.g. an exception escaping
    // deep inside initializeRuntime(), before it ever settles a result --
    // see runRecoveryAction()'s doc comment). A rejection proves NOTHING
    // about isolation, so it is reported as neither isolated nor ready.
    const recoverRuntime = async (): Promise<RuntimeRecoveryResult> => {
      throw new Error("simulated recoverRuntime() rejection");
    };
    const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => null;

    await expect(runRecoveryAction(outcome.recoveryAction, { recoverRuntime, refreshRoutingDecision })).resolves.toEqual({
      recovery: { isolated: false, ready: false },
    });

    // The original message -- id, content, status, incompleteReason,
    // continuationCount -- remains exactly as the revert left it: not
    // deleted, not duplicated, not marked complete, and not further
    // mutated by the failed recovery attempt. AppRuntimeProvider.tsx uses
    // a recovery that is not ready to show storageNotice.runtimeRecoveryFailed
    // -- verified here at the contract point runRecoveryAction() returns, and
    // end-to-end by AppRuntimeProvider.watchdog.test.tsx.
    const reloaded = await getConversation(conversationId);
    const assistantMessages = reloaded?.messages.filter((m) => m.role === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.id).toBe("assistant-1");
    expect(assistantMessages[0]?.content).toBe("Original answer that was interrupted before");
    expect(assistantMessages[0]?.status).toBe("incomplete");
    expect(assistantMessages[0]?.incompleteReason).toBe("length");
    expect(assistantMessages[0]?.continuationCount).toBe(1);
  });

  it("Continue -> cancel_timeout -> revert -> recoverRuntime() resolves false: same intact-message guarantee, reported as a failure", async () => {
    const conversation = await createConversation({ title: "recoverRuntime resolves false during Continue" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    await addMessage(conversationId, {
      id: "assistant-1",
      role: "assistant",
      content: "Original answer that was interrupted before",
      status: "incomplete",
      incompleteReason: "length",
      continuationCount: 1,
    });

    const outcome = await runWatchdogRecovery({
      conversationId,
      assistantMessageId: "assistant-1",
      errorCode: "cancel_timeout",
      isContinuation: true,
      priorContent: "Original answer that was interrupted before",
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      priorContinuationCount: 1,
      currentContent: "Original answer that was interrupted before and some possibly-corrupt new text",
      hasNewOutput: true,
    });
    expect(outcome.persisted).toBe(true);

    // recoverRuntime() settles normally but reports failure (e.g. it was
    // already busy recovering another generation -- see
    // useAdaptiveRuntimeRouting.ts's recoveryInProgressRef guard). The old
    // domain is isolated here, but nothing is usable yet: isolation and
    // readiness are reported independently.
    const recoverRuntime = async (): Promise<RuntimeRecoveryResult> => ({ isolated: true, ready: false });
    const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => null;

    await expect(runRecoveryAction(outcome.recoveryAction, { recoverRuntime, refreshRoutingDecision })).resolves.toEqual({
      recovery: { isolated: true, ready: false },
    });

    const reloaded = await getConversation(conversationId);
    const assistantMessages = reloaded?.messages.filter((m) => m.role === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toBe("Original answer that was interrupted before");
    expect(assistantMessages[0]?.status).toBe("incomplete");
    expect(assistantMessages[0]?.incompleteReason).toBe("length");
    expect(assistantMessages[0]?.continuationCount).toBe(1);
  });

  it("a recovery that is both isolated and ready is reported as such", async () => {
    const recoverRuntime = async (): Promise<RuntimeRecoveryResult> => ({ isolated: true, ready: true });
    const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => null;
    await expect(runRecoveryAction("recover_runtime", { recoverRuntime, refreshRoutingDecision })).resolves.toEqual({
      recovery: { isolated: true, ready: true },
    });
  });

  it("a legacy boolean (or any malformed value) can never be mistaken for proven isolation", async () => {
    const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => null;
    for (const malformed of [true, false, undefined, { ready: true }]) {
      const recoverRuntime = (async () => malformed) as unknown as () => Promise<RuntimeRecoveryResult>;
      await expect(runRecoveryAction("recover_runtime", { recoverRuntime, refreshRoutingDecision })).resolves.toEqual({
        recovery: { isolated: false, ready: false },
      });
    }
  });

  it("refresh_routing without an interrupted generation's owner never recovers the runtime, and reports no recovery at all", async () => {
    let recoverRuntimeCalled = false;
    const recoverRuntime = async (): Promise<RuntimeRecoveryResult> => {
      recoverRuntimeCalled = true;
      return { isolated: true, ready: true };
    };
    let refreshCalled = false;
    const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => {
      refreshCalled = true;
      return null;
    };

    await expect(runRecoveryAction("refresh_routing", { recoverRuntime, refreshRoutingDecision })).resolves.toEqual({
      recovery: null,
    });
    expect(refreshCalled).toBe(true);
    expect(recoverRuntimeCalled).toBe(false);
  });

  it("a routing refresh that throws never masks the outcome", async () => {
    const recoverRuntime = async (): Promise<RuntimeRecoveryResult> => ({ isolated: true, ready: true });
    const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => {
      throw new Error("routing failed");
    };
    await expect(runRecoveryAction("refresh_routing", { recoverRuntime, refreshRoutingDecision })).resolves.toEqual({
      recovery: null,
    });
  });
});

// The reroute that follows a stall recovery may replace the runtime again. Its
// result must be folded into the recovery's, never swallowed: no path may
// report ready=true unless the runtime intended for continued use is
// genuinely ready.
describe("refresh_routing result propagation (recovery + replacement)", () => {
  // A generation whose stream never ends: recovery takes the lease over after
  // a (tiny) owner-release grace and isolates under it.
  function nonCooperativeOwner() {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);
    const recoverRuntime = async (): Promise<RuntimeRecoveryResult> => ({ isolated: true, ready: true });
    return { coordinator, handle, recoverRuntime };
  }
  const grace = { ownerReleaseGraceMs: 1 };

  it("recovery isolated the old worker but the routing replacement FAILED to initialize (initializeRuntime false) -> the final result is NOT ready", async () => {
    const { handle, recoverRuntime } = nonCooperativeOwner();

    const result = await runRecoveryAction("refresh_routing", {
      owner: handle,
      recoverRuntime,
      refreshRoutingDecision: async () => ({ isolated: true, ready: false }),
      isRuntimeReady: () => false,
      ...grace,
    });

    expect(result).toEqual({ recovery: { isolated: true, ready: false } });
  });

  it("the replacement says ready AND the runtime is actually ready -> ready", async () => {
    const { handle, recoverRuntime } = nonCooperativeOwner();

    await expect(
      runRecoveryAction("refresh_routing", {
        owner: handle,
        recoverRuntime,
        refreshRoutingDecision: async () => ({ isolated: true, ready: true }),
        isRuntimeReady: () => true,
        ...grace,
      })
    ).resolves.toEqual({ recovery: { isolated: true, ready: true } });
  });

  it("the replacement claims ready but the live runtime is not ready -> NOT ready (a claim the runtime contradicts)", async () => {
    const { handle, recoverRuntime } = nonCooperativeOwner();

    await expect(
      runRecoveryAction("refresh_routing", {
        owner: handle,
        recoverRuntime,
        refreshRoutingDecision: async () => ({ isolated: true, ready: true }),
        isRuntimeReady: () => false,
        ...grace,
      })
    ).resolves.toEqual({ recovery: { isolated: true, ready: false } });
  });

  it("the routing replacement leaves isolation UNPROVEN (and quarantines) -> {isolated:false, ready:false} and the quarantine stands", async () => {
    const { coordinator, handle, recoverRuntime } = nonCooperativeOwner();

    const result = await runRecoveryAction("refresh_routing", {
      owner: handle,
      recoverRuntime,
      refreshRoutingDecision: async () => {
        // What the hook does when a replacement worker cannot be isolated.
        coordinator.tryAcquire("app-runtime:model_replacement")?.quarantine();
        return { isolated: false, ready: false };
      },
      isRuntimeReady: () => true,
      ...grace,
    });

    expect(result).toEqual({ recovery: { isolated: false, ready: false } });
    expect(coordinator.isQuarantined()).toBe(true);
    expect(coordinator.tryAcquire("anything")).toBeNull();
  });

  it.each([
    ["throws", async (): Promise<RuntimeRecoveryResult | null> => { throw new Error("refresh failed"); }],
    ["rejects", () => Promise.reject(new Error("refresh rejected"))],
  ])("a refresh that %s after a successful recovery can never leave an earlier ready=true standing", async (_label, refreshRoutingDecision) => {
    const { handle, recoverRuntime } = nonCooperativeOwner();

    const result = await runRecoveryAction("refresh_routing", {
      owner: handle,
      recoverRuntime,
      refreshRoutingDecision,
      isRuntimeReady: () => true,
      ...grace,
    });

    expect(result).toEqual({ recovery: { isolated: true, ready: false } });
  });

  it("a malformed (legacy boolean/undefined) replacement result fails closed", async () => {
    for (const malformed of [true, false, undefined, { ready: true }]) {
      const { handle, recoverRuntime } = nonCooperativeOwner();
      const result = await runRecoveryAction("refresh_routing", {
        owner: handle,
        recoverRuntime,
        refreshRoutingDecision: (async () => malformed) as unknown as () => Promise<RuntimeRecoveryResult | null>,
        isRuntimeReady: () => true,
        ...grace,
      });
      // Only an explicit `null` means "no replacement attempted"; anything
      // else that is not a well-formed result is an unproven replacement.
      expect(result.recovery).toEqual({ isolated: false, ready: false });
    }
  });

  it("when the refresh replaced nothing, the recovery's result stands but is still subject to the live readiness check", async () => {
    const ready = nonCooperativeOwner();
    await expect(
      runRecoveryAction("refresh_routing", {
        owner: ready.handle,
        recoverRuntime: ready.recoverRuntime,
        refreshRoutingDecision: async () => null,
        isRuntimeReady: () => true,
        ...grace,
      })
    ).resolves.toEqual({ recovery: { isolated: true, ready: true } });

    const notReady = nonCooperativeOwner();
    await expect(
      runRecoveryAction("refresh_routing", {
        owner: notReady.handle,
        recoverRuntime: notReady.recoverRuntime,
        refreshRoutingDecision: async () => null,
        isRuntimeReady: () => false,
        ...grace,
      })
    ).resolves.toEqual({ recovery: { isolated: true, ready: false } });
  });

  it("a recovery that could not prove isolation (quarantined) is never followed by an automatic reroute", async () => {
    const { coordinator, handle } = nonCooperativeOwner();
    let refreshCalls = 0;

    const result = await runRecoveryAction("refresh_routing", {
      owner: handle,
      recoverRuntime: async () => ({ isolated: false, ready: false }),
      refreshRoutingDecision: async () => {
        refreshCalls += 1;
        return { isolated: true, ready: true };
      },
      isRuntimeReady: () => true,
      ...grace,
    });

    expect(refreshCalls).toBe(0);
    expect(result).toEqual({ recovery: { isolated: false, ready: false } });
    expect(coordinator.isQuarantined()).toBe(true);
  });

  it("recover_runtime (cancel_timeout) is also subject to the live readiness check", async () => {
    const { handle, recoverRuntime } = nonCooperativeOwner();

    await expect(
      runRecoveryAction("recover_runtime", {
        owner: handle,
        recoverRuntime,
        refreshRoutingDecision: async () => null,
        isRuntimeReady: () => false,
      })
    ).resolves.toEqual({ recovery: { isolated: true, ready: false } });
  });

  it("with no recovery at all, a failing refresh reports nothing while the runtime is still ready, and not-ready when it is not", async () => {
    const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => {
      throw new Error("refresh failed");
    };
    const recoverRuntime = async (): Promise<RuntimeRecoveryResult> => ({ isolated: true, ready: true });

    await expect(
      runRecoveryAction("refresh_routing", { recoverRuntime, refreshRoutingDecision, isRuntimeReady: () => true })
    ).resolves.toEqual({ recovery: null });
    await expect(
      runRecoveryAction("refresh_routing", { recoverRuntime, refreshRoutingDecision, isRuntimeReady: () => false })
    ).resolves.toEqual({ recovery: { isolated: true, ready: false } });
  });
});

describe("combineRecoveryWithRefresh", () => {
  const ok: RuntimeRecoveryResult = { isolated: true, ready: true };

  it("returns null only when neither a recovery nor a replacement happened", () => {
    expect(combineRecoveryWithRefresh(null, { kind: "completed", replacement: null })).toBeNull();
  });

  it("a replacement's own result supersedes the earlier recovery's readiness (the replacement is the runtime that will be used)", () => {
    expect(
      combineRecoveryWithRefresh({ isolated: true, ready: false }, { kind: "completed", replacement: ok }, () => true)
    ).toEqual({ isolated: true, ready: true });
  });

  it("isolation must hold for both the recovery and the replacement", () => {
    expect(
      combineRecoveryWithRefresh({ isolated: false, ready: false }, { kind: "completed", replacement: ok }, () => true)
    ).toEqual({ isolated: false, ready: false });
    expect(
      combineRecoveryWithRefresh(ok, { kind: "completed", replacement: { isolated: false, ready: false } }, () => true)
    ).toEqual({ isolated: false, ready: false });
  });

  it("never reports ready without isolation, whatever a result claims", () => {
    expect(
      combineRecoveryWithRefresh(ok, { kind: "completed", replacement: { isolated: false, ready: true } as RuntimeRecoveryResult }, () => true)
    ).toEqual({ isolated: false, ready: false });
  });
});

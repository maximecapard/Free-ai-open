import { describe, expect, it } from "vitest";
import {
  buildConversationExport,
  parseConversationImport,
  prepareImportedConversations,
  serializeConversationExport,
} from "@free-ai-open/conversation-export";
import { addMessage, createConversation, getConversation } from "@free-ai-open/conversation-store";
import type { GenerateChunk, GenerationRuntimeMetrics, InferenceRuntime } from "@free-ai-open/ai-runtime";
import { runContinuationAttempt } from "./continuationExecution";

// This file only exercises runContinuationAttempt()'s handling of
// GenerateChunk's `reason`/`text` fields, never its `metrics` -- a single
// shared, minimally-valid stub keeps every "done" chunk fixture below
// type-correct without pretending these tests care about metrics content.
const FAKE_METRICS: GenerationRuntimeMetrics = {
  inferenceStartedAt: 0,
  firstTokenAt: null,
  timeToFirstTokenMs: null,
  completedAt: 0,
  generationDurationMs: 0,
  usage: { tokenCountConfidence: "unavailable" },
};

function fakeRuntime(chunks: readonly GenerateChunk[]): Pick<InferenceRuntime, "generate"> {
  return {
    async *generate() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe("runContinuationAttempt", () => {
  it("MANDATORY REGRESSION: a successful continuation persists its exact merged content and survives a fresh reload from storage -- the exact blocker where reading the generation accumulator AFTER clearing it silently fell back to priorContent", async () => {
    const conversation = await createConversation({ title: "Regression" });
    expect(conversation).not.toBeNull();
    const conversationId = conversation!.id;

    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain BeautifulSoup" });
    const added = await addMessage(conversationId, {
      id: "assistant-1",
      role: "assistant",
      content: "Here is the start of the answer",
      status: "incomplete",
      incompleteReason: "length",
    });
    expect(added).not.toBeNull();
    expect(added?.conversation.messages).toHaveLength(2);

    // Several streamed chunks, then a natural stop -- mirrors the mission's
    // exact required flow: prior message -> Continue -> several chunks ->
    // natural stop -> IndexedDB -> reload -> exact extended message.
    const runtime = fakeRuntime([
      { type: "token", text: " that" },
      { type: "token", text: " continues" },
      { type: "token", text: " naturally." },
      { type: "done", reason: "completed", metrics: FAKE_METRICS },
    ]);

    const outcome = await runContinuationAttempt({
      runtime,
      conversationId,
      assistantMessageId: "assistant-1",
      priorContent: "Here is the start of the answer",
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      nextContinuationCount: 1,
      continuationPrompt: "continue from here",
      responseLocale: "en",
      maxOutputTokens: 256,
    });

    expect(outcome.kind).toBe("persisted");
    if (outcome.kind !== "persisted") throw new Error("expected a persisted outcome");
    expect(outcome.finalContent).toBe("Here is the start of the answer that continues naturally.");
    expect(outcome.status).toBe("complete");
    expect(outcome.incompleteReason).toBeUndefined();
    expect(outcome.persisted).toBe(true);

    // "IndexedDB -> reload": fetch fresh from the store, exactly like
    // AppRuntimeProvider.tsx does on mount/conversation switch -- NOT the
    // value this function returned, to prove the write actually landed.
    const reloaded = await getConversation(conversationId);
    const assistantMessages = reloaded?.messages.filter((message) => message.role === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1); // no duplicate bubble
    const reloadedMessage = assistantMessages[0];
    expect(reloadedMessage?.content).toBe("Here is the start of the answer that continues naturally.");
    expect(reloadedMessage?.status).toBe("complete");
    expect(reloadedMessage?.incompleteReason).toBeUndefined();
    expect(reloadedMessage?.continuationCount).toBe(1);

    // Item 11: "IndexedDB, reload, export, AND import" -- the full
    // conversation (not just this one message) must carry the exact
    // completed/continued state through a full export -> serialize ->
    // parse -> prepare -> re-persist round trip, mirroring exactly what
    // chat/page.tsx's export-all and import-file actions do.
    const exportData = buildConversationExport([reloaded!]);
    const exportedMessage = exportData.conversations[0]?.messages.find((message) => message.role === "assistant");
    expect(exportedMessage).toMatchObject({
      content: "Here is the start of the answer that continues naturally.",
      status: "complete",
      continuationCount: 1,
    });
    expect(exportedMessage).not.toHaveProperty("incompleteReason");

    const importJson = serializeConversationExport(exportData);
    const parsed = parseConversationImport(importJson);
    const prepared = prepareImportedConversations(parsed, { idFactory: (prefix) => `${prefix}-imported` });
    expect(prepared).toHaveLength(1);

    const importedConversation = await createConversation({
      id: prepared[0]!.id,
      title: prepared[0]!.title,
      createdAt: prepared[0]!.createdAt,
      task: prepared[0]!.task,
    });
    expect(importedConversation).not.toBeNull();
    for (const importedMessage of prepared[0]!.messages) {
      const savedImportedMessage = await addMessage(importedConversation!.id, {
        id: importedMessage.id,
        role: importedMessage.role,
        content: importedMessage.content,
        createdAt: importedMessage.createdAt,
        status: importedMessage.status,
        incompleteReason: importedMessage.incompleteReason,
        continuationCount: importedMessage.continuationCount,
      });
      expect(savedImportedMessage).not.toBeNull();
      expect(savedImportedMessage?.truncated).toBe(false);
    }

    const reimported = await getConversation(importedConversation!.id);
    const reimportedAssistantMessage = reimported?.messages.find((message) => message.role === "assistant");
    expect(reimportedAssistantMessage?.content).toBe("Here is the start of the answer that continues naturally.");
    expect(reimportedAssistantMessage?.status).toBe("complete");
    expect(reimportedAssistantMessage?.incompleteReason).toBeUndefined();
    expect(reimportedAssistantMessage?.continuationCount).toBe(1);
  });

  it("keeps the message incomplete with a matching reason when the continuation itself hits the length limit again", async () => {
    const conversation = await createConversation({ title: "Length again" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    await addMessage(conversationId, {
      id: "assistant-1",
      role: "assistant",
      content: "First part",
      status: "incomplete",
      incompleteReason: "length",
    });

    const runtime = fakeRuntime([
      { type: "token", text: " second part" },
      { type: "done", reason: "length", metrics: FAKE_METRICS },
    ]);

    const outcome = await runContinuationAttempt({
      runtime,
      conversationId,
      assistantMessageId: "assistant-1",
      priorContent: "First part",
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      nextContinuationCount: 1,
      continuationPrompt: "continue",
      responseLocale: "en",
      maxOutputTokens: 64,
    });

    expect(outcome.kind).toBe("persisted");
    if (outcome.kind !== "persisted") throw new Error("expected a persisted outcome");
    expect(outcome.finalContent).toBe("First part second part");
    expect(outcome.status).toBe("incomplete");
    expect(outcome.incompleteReason).toBe("length");

    const reloaded = await getConversation(conversationId);
    const message = reloaded?.messages.find((m) => m.id === "assistant-1");
    expect(message?.status).toBe("incomplete");
    expect(message?.incompleteReason).toBe("length");
  });

  it("reverts to the exact prior content/status/reason when the user stops mid-continuation, without deleting the message", async () => {
    const conversation = await createConversation({ title: "Stopped" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    await addMessage(conversationId, {
      id: "assistant-1",
      role: "assistant",
      content: "Original partial answer",
      status: "incomplete",
      incompleteReason: "length",
    });

    const runtime = fakeRuntime([
      { type: "token", text: " some new text that should be discarded" },
      { type: "done", reason: "cancelled", metrics: FAKE_METRICS },
    ]);

    const outcome = await runContinuationAttempt({
      runtime,
      conversationId,
      assistantMessageId: "assistant-1",
      priorContent: "Original partial answer",
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      nextContinuationCount: 1,
      continuationPrompt: "continue",
      responseLocale: "en",
      maxOutputTokens: 64,
    });

    expect(outcome.kind).toBe("reverted");
    if (outcome.kind !== "reverted") throw new Error("expected a reverted outcome");
    expect(outcome.finalContent).toBe("Original partial answer");
    expect(outcome.status).toBe("incomplete");
    expect(outcome.incompleteReason).toBe("length");

    const reloaded = await getConversation(conversationId);
    const message = reloaded?.messages.find((m) => m.id === "assistant-1");
    expect(message?.content).toBe("Original partial answer");
    expect(message?.incompleteReason).toBe("length");
    // continuationCount is not reverted -- the attempt was used the moment
    // it started, per the mission's explicit "no automatic continuation
    // loop" requirement (a caller persists this count before ever calling
    // runContinuationAttempt; this function just passes it through).
  });

  it("reverts on degenerate output the same way as a user Stop", async () => {
    const conversation = await createConversation({ title: "Degenerate" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    await addMessage(conversationId, { id: "assistant-1", role: "assistant", content: "Fine so far", status: "incomplete" });

    const runtime = fakeRuntime([
      { type: "token", text: "!!!!!!!!!!!!!!!!!!!!" },
      { type: "done", reason: "degenerate_output", metrics: FAKE_METRICS },
    ]);

    const outcome = await runContinuationAttempt({
      runtime,
      conversationId,
      assistantMessageId: "assistant-1",
      priorContent: "Fine so far",
      priorStatus: "incomplete",
      priorIncompleteReason: undefined,
      nextContinuationCount: 1,
      continuationPrompt: "continue",
      responseLocale: "en",
      maxOutputTokens: 64,
    });

    expect(outcome.kind).toBe("reverted");
    if (outcome.kind !== "reverted") throw new Error("expected a reverted outcome");
    expect(outcome.finalContent).toBe("Fine so far");
  });

  it("abandons without persisting anything once superseded by a newer generation", async () => {
    const conversation = await createConversation({ title: "Superseded" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    await addMessage(conversationId, { id: "assistant-1", role: "assistant", content: "Prior", status: "incomplete" });

    const runtime = fakeRuntime([
      { type: "token", text: " more" },
      { type: "done", reason: "completed", metrics: FAKE_METRICS },
    ]);

    const outcome = await runContinuationAttempt({
      runtime,
      conversationId,
      assistantMessageId: "assistant-1",
      priorContent: "Prior",
      priorStatus: "incomplete",
      priorIncompleteReason: undefined,
      nextContinuationCount: 1,
      continuationPrompt: "continue",
      responseLocale: "en",
      maxOutputTokens: 64,
      isStillCurrent: () => false,
    });

    expect(outcome.kind).toBe("abandoned");
    const reloaded = await getConversation(conversationId);
    expect(reloaded?.messages.find((m) => m.id === "assistant-1")?.content).toBe("Prior");
  });

  it("item 4 (mandatory): when persistence truncates the merged content, the returned outcome adopts the exact normalized/truncated content, status, and reason -- never the pre-truncation local value", async () => {
    const conversation = await createConversation({ title: "Truncation sync" });
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

    // priorContent (60,000 chars) + this delta (10,000 chars, no overlap
    // with the all-"a" prior content) exceeds the store's 64,000-character
    // ceiling by 6,000 characters, forcing a real truncation.
    const hugeDelta = "b".repeat(10_000);
    const runtime = fakeRuntime([
      { type: "token", text: hugeDelta },
      { type: "done", reason: "completed", metrics: FAKE_METRICS },
    ]);

    const outcome = await runContinuationAttempt({
      runtime,
      conversationId,
      assistantMessageId: "assistant-1",
      priorContent,
      priorStatus: "incomplete",
      priorIncompleteReason: "length",
      nextContinuationCount: 1,
      continuationPrompt: "continue",
      responseLocale: "en",
      maxOutputTokens: 4096,
    });

    expect(outcome.kind).toBe("persisted");
    if (outcome.kind !== "persisted") throw new Error("expected a persisted outcome");
    expect(outcome.truncated).toBe(true);
    // The outcome's own finalContent/status/incompleteReason are exactly
    // what AppRuntimeProvider.tsx's setMessages() adopts -- they must
    // already be the AUTHORITATIVE truncated/forced-incomplete values from
    // the store, not the locally computed pre-truncation merge (which
    // would be 70,000 characters with status "complete", since the
    // generation itself finished naturally).
    expect(outcome.finalContent.length).toBe(64_000);
    expect(outcome.status).toBe("incomplete");
    expect(outcome.incompleteReason).toBe("truncated");

    // Reload proves this is byte-identical to a fresh read of IndexedDB --
    // the value a caller adopts into UI state and the value a reload shows
    // can never diverge.
    const reloaded = await getConversation(conversationId);
    const reloadedMessage = reloaded?.messages.find((message) => message.id === "assistant-1");
    expect(reloadedMessage?.content).toBe(outcome.finalContent);
    expect(reloadedMessage?.content.length).toBe(64_000);
    expect(reloadedMessage?.status).toBe("incomplete");
    expect(reloadedMessage?.incompleteReason).toBe("truncated");
  });

  it("reports firstTokenAt-style progress via onProgress with the deduplicated merged content, not raw chunk text", async () => {
    const conversation = await createConversation({ title: "Progress" });
    const conversationId = conversation!.id;
    await addMessage(conversationId, { id: "user-1", role: "user", content: "Explain X" });
    // A join-point overlap must be well above continuationMerge.ts's
    // 24-character minimum to actually be deduplicated (item 5) -- a
    // 3-character fixture like "abc" would now correctly be LEFT alone.
    const priorContent = "This is the shared tail end of the prior reply";
    await addMessage(conversationId, { id: "assistant-1", role: "assistant", content: priorContent, status: "incomplete" });

    const runtime = fakeRuntime([
      { type: "token", text: priorContent }, // fully overlaps the prior content's tail
      { type: "token", text: " and this is genuinely new." },
      { type: "done", reason: "completed", metrics: FAKE_METRICS },
    ]);

    const progressUpdates: string[] = [];
    const outcome = await runContinuationAttempt({
      runtime,
      conversationId,
      assistantMessageId: "assistant-1",
      priorContent,
      priorStatus: "incomplete",
      priorIncompleteReason: undefined,
      nextContinuationCount: 1,
      continuationPrompt: "continue",
      responseLocale: "en",
      maxOutputTokens: 64,
      onProgress: (mergedContent) => progressUpdates.push(mergedContent),
    });

    expect(progressUpdates).toEqual([priorContent, `${priorContent} and this is genuinely new.`]);
    expect(outcome.kind).toBe("persisted");
    if (outcome.kind !== "persisted") throw new Error("expected a persisted outcome");
    expect(outcome.finalContent).toBe(`${priorContent} and this is genuinely new.`);
  });
});

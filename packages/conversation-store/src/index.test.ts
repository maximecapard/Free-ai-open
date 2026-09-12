import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createConversationStoreClient } from "./index";
import type { Conversation, ConversationId, ConversationStore } from "./types";

const DB_NAME = "free-ai-open-conversations";

class MemoryTestStore implements ConversationStore {
  records = new Map<ConversationId, Conversation>();

  async put(conversation: Conversation): Promise<void> {
    this.records.set(conversation.id, {
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message })),
    });
  }

  async get(id: ConversationId): Promise<Conversation | null> {
    const conversation = this.records.get(id);
    return conversation
      ? { ...conversation, messages: conversation.messages.map((message) => ({ ...message })) }
      : null;
  }

  async getAll(): Promise<Conversation[]> {
    return [...this.records.values()].map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message })),
    }));
  }

  async update(
    id: ConversationId,
    updater: (conversation: Conversation) => Conversation | null
  ): Promise<Conversation | null> {
    const current = this.records.get(id);
    if (!current) return null;
    const updated = updater({ ...current, messages: current.messages.map((message) => ({ ...message })) });
    if (!updated) return null;
    await this.put(updated);
    return { ...updated, messages: updated.messages.map((message) => ({ ...message })) };
  }

  async delete(id: ConversationId): Promise<void> {
    this.records.delete(id);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

class FailingConversationStore implements ConversationStore {
  async put(): Promise<void> {
    throw new Error("storage failed");
  }

  async get(): Promise<Conversation | null> {
    throw new Error("storage failed");
  }

  async getAll(): Promise<Conversation[]> {
    throw new Error("storage failed");
  }

  async update(): Promise<Conversation | null> {
    throw new Error("storage failed");
  }

  async delete(): Promise<void> {
    throw new Error("storage failed");
  }

  async clear(): Promise<void> {
    throw new Error("storage failed");
  }
}

const baseNow = new Date("2026-07-04T10:00:00.000Z");

function createTestClient(store: ConversationStore | null = new MemoryTestStore()) {
  let id = 0;
  return createConversationStoreClient({
    store,
    now: () => baseNow,
    idFactory: () => `conversation-${++id}`,
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function resetFakeIndexedDb(): Promise<void> {
  await requestToPromise(fakeIndexedDB.deleteDatabase(DB_NAME));
}

async function withFakeIndexedDb(test: () => Promise<void>): Promise<void> {
  const hadIndexedDb = "indexedDB" in globalThis;
  const previousIndexedDb = hadIndexedDb ? globalThis.indexedDB : undefined;

  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  await resetFakeIndexedDb();

  try {
    await test();
  } finally {
    await resetFakeIndexedDb();
    if (hadIndexedDb) {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previousIndexedDb });
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
}

async function withIndexedDbUnavailable(test: () => Promise<void>): Promise<void> {
  const hadIndexedDb = "indexedDB" in globalThis;
  const previousIndexedDb = hadIndexedDb ? globalThis.indexedDB : undefined;

  Reflect.deleteProperty(globalThis, "indexedDB");

  try {
    await test();
  } finally {
    if (hadIndexedDb) {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previousIndexedDb });
    }
  }
}

describe("conversation store", () => {
  it("persists core operations through IndexedDB using fake-indexeddb", async () => {
    await withFakeIndexedDb(async () => {
      let id = 0;
      let minute = 0;
      const client = createConversationStoreClient({
        now: () => new Date(`2026-07-04T10:${String(minute++).padStart(2, "0")}:00.000Z`),
        idFactory: () => `conversation-indexeddb-${++id}`,
      });

      const conversation = await client.createConversation({ title: "IndexedDB chat" });
      expect(conversation).toMatchObject({
        id: "conversation-indexeddb-1",
        title: "IndexedDB chat",
        schemaVersion: 1,
        messageCount: 0,
        messages: [],
      });

      await expect(client.listConversations()).resolves.toMatchObject([
        { id: "conversation-indexeddb-1", title: "IndexedDB chat", messageCount: 0 },
      ]);
      await expect(client.getConversation(conversation!.id)).resolves.toMatchObject({
        id: "conversation-indexeddb-1",
        title: "IndexedDB chat",
        messages: [],
      });

      const withMessage = await client.addMessage(conversation!.id, {
        role: "user",
        content: "private prompt stored locally",
      });
      expect(withMessage?.truncated).toBe(false);
      expect(withMessage?.conversation.messageCount).toBe(1);
      await expect(client.getConversation(conversation!.id)).resolves.toMatchObject({
        messages: [expect.objectContaining({ role: "user", content: "private prompt stored locally" })],
      });

      const renamed = await client.updateConversationTitle(conversation!.id, "Renamed IndexedDB chat");
      expect(renamed?.title).toBe("Renamed IndexedDB chat");
      await expect(client.listConversations()).resolves.toMatchObject([
        { id: "conversation-indexeddb-1", title: "Renamed IndexedDB chat", messageCount: 1 },
      ]);

      await expect(client.deleteConversation(conversation!.id)).resolves.toBe(true);
      await expect(client.getConversation(conversation!.id)).resolves.toBeNull();
      await expect(client.listConversations()).resolves.toEqual([]);

      await client.createConversation({ title: "One" });
      await client.createConversation({ title: "Two" });
      await expect(client.listConversations()).resolves.toHaveLength(2);

      await client.clearAllConversations();
      await expect(client.listConversations()).resolves.toEqual([]);
    });
  });

  it("creates, lists, and gets conversations", async () => {
    const client = createTestClient();

    const conversation = await client.createConversation({ title: "Project notes" });

    expect(conversation).toMatchObject({
      id: "conversation-1",
      title: "Project notes",
      schemaVersion: 1,
      createdAt: "2026-07-04T10:00:00.000Z",
      updatedAt: "2026-07-04T10:00:00.000Z",
      messageCount: 0,
      messages: [],
    });
    await expect(client.getConversation(conversation!.id)).resolves.toEqual(conversation);
    await expect(client.listConversations()).resolves.toEqual([
      {
        id: "conversation-1",
        title: "Project notes",
        schemaVersion: 1,
        createdAt: "2026-07-04T10:00:00.000Z",
        updatedAt: "2026-07-04T10:00:00.000Z",
        messageCount: 0,
      },
    ]);
  });

  it("adds messages locally and enforces the message limit", async () => {
    const client = createConversationStoreClient({
      store: new MemoryTestStore(),
      now: () => baseNow,
      idFactory: () => "conversation-1",
      limits: { maxMessagesPerConversation: 2 },
    });
    const conversation = await client.createConversation();

    await client.addMessage(conversation!.id, { role: "user", content: "first private prompt" });
    await client.addMessage(conversation!.id, { role: "assistant", content: "private answer" });
    const updated = await client.addMessage(conversation!.id, { role: "user", content: "latest private prompt" });

    expect(updated?.conversation.messageCount).toBe(2);
    expect(updated?.conversation.messages.map((message) => message.content)).toEqual([
      "private answer",
      "latest private prompt",
    ]);
  });

  it("preserves an incomplete assistant status and keeps legacy messages compatible", async () => {
    const store = new MemoryTestStore();
    const client = createTestClient(store);
    const conversation = await client.createConversation();

    await client.addMessage(conversation!.id, {
      role: "assistant",
      content: "partial local reply",
      status: "incomplete",
    });

    await expect(client.getConversation(conversation!.id)).resolves.toMatchObject({
      messages: [expect.objectContaining({ content: "partial local reply", status: "incomplete" })],
    });

    const stored = store.records.get(conversation!.id)!;
    stored.messages.push({
      id: "legacy-message",
      role: "assistant",
      content: "legacy completed reply",
      createdAt: baseNow.toISOString(),
    });
    stored.messageCount = stored.messages.length;

    const reloaded = await client.getConversation(conversation!.id);
    expect(reloaded?.messages.at(-1)?.status).toBeUndefined();
  });

  it("stores and round-trips incompleteReason and continuationCount, and leaves them absent for legacy messages with neither field", async () => {
    const store = new MemoryTestStore();
    const client = createTestClient(store);
    const conversation = await client.createConversation();

    await client.addMessage(conversation!.id, {
      id: "assistant-1",
      role: "assistant",
      content: "<think>ran out of budget",
      status: "incomplete",
      incompleteReason: "length",
      continuationCount: 1,
    });

    await expect(client.getConversation(conversation!.id)).resolves.toMatchObject({
      messages: [
        expect.objectContaining({
          id: "assistant-1",
          status: "incomplete",
          incompleteReason: "length",
          continuationCount: 1,
        }),
      ],
    });

    const stored = store.records.get(conversation!.id)!;
    stored.messages.push({
      id: "legacy-message",
      role: "assistant",
      content: "legacy completed reply",
      createdAt: baseNow.toISOString(),
    });
    stored.messageCount = stored.messages.length;

    const reloaded = await client.getConversation(conversation!.id);
    const legacy = reloaded?.messages.at(-1);
    expect(legacy?.incompleteReason).toBeUndefined();
    expect(legacy?.continuationCount).toBeUndefined();
  });

  it("updates an existing message's content and status in place, without creating a duplicate", async () => {
    const store = new MemoryTestStore();
    const client = createTestClient(store);
    const conversation = await client.createConversation();
    const withMessage = await client.addMessage(conversation!.id, {
      id: "assistant-1",
      role: "assistant",
      content: "<think>partial reasoning",
      status: "incomplete",
    });
    expect(withMessage?.conversation.messageCount).toBe(1);

    const updated = await client.updateMessageContent(conversation!.id, "assistant-1", {
      content: "<think>partial reasoning continued</think>\n\nFinal answer.",
      status: "complete",
    });

    expect(updated?.truncated).toBe(false);
    expect(updated?.conversation.messageCount).toBe(1);
    expect(updated?.conversation.messages).toEqual([
      expect.objectContaining({
        id: "assistant-1",
        content: "<think>partial reasoning continued</think>\n\nFinal answer.",
        status: "complete",
      }),
    ]);
  });

  it("preserves status/incompleteReason/continuationCount when updateMessageContent does not override them", async () => {
    const store = new MemoryTestStore();
    const client = createTestClient(store);
    const conversation = await client.createConversation();
    await client.addMessage(conversation!.id, {
      id: "assistant-1",
      role: "assistant",
      content: "<think>reasoning so far",
      status: "incomplete",
      incompleteReason: "length",
      continuationCount: 1,
    });

    // Only content changes here -- status/incompleteReason/continuationCount
    // are intentionally omitted, and must be left exactly as they were.
    const updated = await client.updateMessageContent(conversation!.id, "assistant-1", {
      content: "<think>reasoning so far and more",
    });

    expect(updated?.conversation.messages).toEqual([
      expect.objectContaining({
        id: "assistant-1",
        content: "<think>reasoning so far and more",
        status: "incomplete",
        incompleteReason: "length",
        continuationCount: 1,
      }),
    ]);
  });

  it("explicitly clears incompleteReason when passed null, e.g. a successful Continue completing a length-limited message", async () => {
    const store = new MemoryTestStore();
    const client = createTestClient(store);
    const conversation = await client.createConversation();
    await client.addMessage(conversation!.id, {
      id: "assistant-1",
      role: "assistant",
      content: "partial reply",
      status: "incomplete",
      incompleteReason: "length",
      continuationCount: 1,
    });

    const updated = await client.updateMessageContent(conversation!.id, "assistant-1", {
      content: "partial reply and now the rest of the answer",
      status: "complete",
      incompleteReason: null,
    });

    const message = updated?.conversation.messages[0];
    expect(message?.status).toBe("complete");
    expect(message?.incompleteReason).toBeUndefined();
    // The field must be entirely ABSENT, not merely `undefined` as an own
    // property -- a stale key surviving on the object would still round-trip
    // through JSON-based storage/export in some environments.
    expect(Object.prototype.hasOwnProperty.call(message ?? {}, "incompleteReason")).toBe(false);
    // continuationCount is untouched by this call (omitted), so it must
    // still carry whatever it already was.
    expect(message?.continuationCount).toBe(1);

    const reloaded = await client.getConversation(conversation!.id);
    expect(reloaded?.messages[0]?.incompleteReason).toBeUndefined();
    expect(reloaded?.messages[0]?.status).toBe("complete");
  });

  it("clearing incompleteReason with null on a message that never had one is a harmless no-op", async () => {
    const store = new MemoryTestStore();
    const client = createTestClient(store);
    const conversation = await client.createConversation();
    await client.addMessage(conversation!.id, { id: "assistant-1", role: "assistant", content: "short" });

    const updated = await client.updateMessageContent(conversation!.id, "assistant-1", {
      content: "short reply",
      incompleteReason: null,
    });

    expect(updated?.conversation.messages[0]?.incompleteReason).toBeUndefined();
  });

  it("leaves the conversation unchanged when updating a message id that does not exist", async () => {
    const store = new MemoryTestStore();
    const client = createTestClient(store);
    const conversation = await client.createConversation();
    await client.addMessage(conversation!.id, { id: "real-message", role: "user", content: "hi" });

    const result = await client.updateMessageContent(conversation!.id, "no-such-message", { content: "ignored" });

    expect(result?.conversation.messages).toEqual([expect.objectContaining({ id: "real-message", content: "hi" })]);
  });

  it("does not recreate an IndexedDB conversation when delete races an atomic append", async () => {
    await withFakeIndexedDb(async () => {
      const client = createConversationStoreClient({
        now: () => baseNow,
        idFactory: () => "conversation-race",
      });
      const conversation = await client.createConversation({ title: "Delete during append" });

      const append = client.addMessage(conversation!.id, { role: "assistant", content: "partial reply" });
      const deletion = client.deleteConversation(conversation!.id);
      await Promise.all([append, deletion]);

      await expect(client.getConversation(conversation!.id)).resolves.toBeNull();
    });
  });

  it("renames a conversation", async () => {
    const client = createTestClient();
    const conversation = await client.createConversation({ title: "Untitled" });

    const renamed = await client.updateConversationTitle(conversation!.id, "Renamed conversation");

    expect(renamed?.title).toBe("Renamed conversation");
    await expect(client.getConversation(conversation!.id)).resolves.toMatchObject({ title: "Renamed conversation" });
  });

  it("deletes one conversation", async () => {
    const client = createTestClient();
    const conversation = await client.createConversation({ title: "Delete me" });

    await expect(client.deleteConversation(conversation!.id)).resolves.toBe(true);
    await expect(client.getConversation(conversation!.id)).resolves.toBeNull();
    await expect(client.listConversations()).resolves.toEqual([]);
  });

  it("clears all conversations", async () => {
    const client = createTestClient();
    await client.createConversation({ title: "One" });
    await client.createConversation({ title: "Two" });

    await client.clearAllConversations();

    await expect(client.listConversations()).resolves.toEqual([]);
  });

  it("falls back to memory storage when no store is provided", async () => {
    const client = createTestClient(null);

    const conversation = await client.createConversation({ title: "Memory fallback" });
    await client.addMessage(conversation!.id, { role: "user", content: "local only" });

    await expect(client.getConversation(conversation!.id)).resolves.toMatchObject({
      title: "Memory fallback",
      messages: [expect.objectContaining({ content: "local only" })],
    });
  });

  it("falls back to memory storage when IndexedDB is unavailable", async () => {
    await withIndexedDbUnavailable(async () => {
      let id = 0;
      const client = createConversationStoreClient({
        now: () => baseNow,
        idFactory: () => `conversation-memory-${++id}`,
      });

      const conversation = await client.createConversation({ title: "No IndexedDB" });
      await client.addMessage(conversation!.id, { role: "user", content: "local fallback prompt" });

      await expect(client.getConversation(conversation!.id)).resolves.toMatchObject({
        id: "conversation-memory-1",
        title: "No IndexedDB",
        messages: [expect.objectContaining({ content: "local fallback prompt" })],
      });
    });
  });

  it("swallows storage errors and never throws into the app", async () => {
    const client = createTestClient(new FailingConversationStore());
    const id = "conversation-1" as ConversationId;

    await expect(client.createConversation()).resolves.toBeNull();
    await expect(client.getConversation(id)).resolves.toBeNull();
    await expect(client.listConversations()).resolves.toEqual([]);
    await expect(client.addMessage(id, { role: "user", content: "private prompt" })).resolves.toBeNull();
    await expect(client.updateConversationTitle(id, "Title")).resolves.toBeNull();
    await expect(client.deleteConversation(id)).resolves.toBe(false);
    await expect(client.clearAllConversations()).resolves.toBeUndefined();
  });

  it("limits total conversations and returns recent metadata", async () => {
    let minute = 0;
    const client = createConversationStoreClient({
      store: new MemoryTestStore(),
      now: () => new Date(`2026-07-04T10:${String(minute++).padStart(2, "0")}:00.000Z`),
      idFactory: () => `conversation-${minute}`,
      limits: { maxConversations: 2 },
    });

    await client.createConversation({ title: "Old" });
    await client.createConversation({ title: "Middle" });
    await client.createConversation({ title: "New" });

    await expect(client.listConversations()).resolves.toMatchObject([
      { title: "New" },
      { title: "Middle" },
    ]);
    await expect(client.getRecentConversations(1)).resolves.toMatchObject([{ title: "New" }]);
  });

  it("stores and returns the optional task field on create, get, and list", async () => {
    const client = createTestClient();

    const created = await client.createConversation({ title: "Coding help", task: "coding" });
    expect(created?.task).toBe("coding");

    await expect(client.getConversation(created!.id)).resolves.toMatchObject({ task: "coding" });
    await expect(client.listConversations()).resolves.toMatchObject([{ task: "coding" }]);
  });

  it("leaves task undefined for conversations created without one, for safe migration of old data", async () => {
    const client = createTestClient();

    const created = await client.createConversation({ title: "No task set" });
    expect(created?.task).toBeUndefined();

    await expect(client.getConversation(created!.id)).resolves.toMatchObject({ task: undefined });
  });

  it("does not make network requests or send beacons", async () => {
    const fetchSpy = vi.fn();
    const sendBeaconSpy = vi.fn();
    const previousFetch = globalThis.fetch;
    const previousNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchSpy });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: sendBeaconSpy } });

    try {
      const client = createTestClient();
      const conversation = await client.createConversation({ title: "Private" });
      await client.addMessage(conversation!.id, { role: "user", content: "private prompt" });
      await client.listConversations();
      await client.getConversation(conversation!.id);
      await client.clearAllConversations();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sendBeaconSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: previousFetch });
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
    }
  });

  describe("storage ceiling (never silently loses data without a signal)", () => {
    it("never truncates a long initial reply plus up to the supported number of continuations (48,000 characters)", async () => {
      const client = createTestClient();
      const conversation = await client.createConversation();

      // 1 initial reply (12,000 chars, ai-runtime's own per-generation
      // safety ceiling) + 3 manual continuations of 12,000 chars each =
      // 48,000 chars total -- the documented worst case this store's
      // maxMessageLength must comfortably exceed.
      const initial = "a".repeat(12_000);
      const added = await client.addMessage(conversation!.id, {
        id: "assistant-1",
        role: "assistant",
        content: initial,
        status: "incomplete",
        incompleteReason: "length",
      });
      expect(added?.truncated).toBe(false);

      let merged = initial;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        merged += "b".repeat(12_000);
        const updated = await client.updateMessageContent(conversation!.id, "assistant-1", {
          content: merged,
          status: attempt === 2 ? "complete" : "incomplete",
        });
        expect(updated?.truncated).toBe(false);
      }

      expect(merged.length).toBe(48_000);
      const reloaded = await client.getConversation(conversation!.id);
      expect(reloaded?.messages[0]?.content).toBe(merged);
      expect(reloaded?.messages[0]?.content.length).toBe(48_000);
      expect(reloaded?.messages[0]?.status).toBe("complete");
    });

    it("truncates content that genuinely exceeds the storage ceiling, but never silently: it forces status incomplete with incompleteReason truncated and reports truncated: true", async () => {
      const client = createConversationStoreClient({
        store: new MemoryTestStore(),
        now: () => baseNow,
        idFactory: () => "conversation-1",
        limits: { maxMessageLength: 100 },
      });
      const conversation = await client.createConversation();

      const oversized = "x".repeat(500);
      const added = await client.addMessage(conversation!.id, {
        role: "assistant",
        content: oversized,
        status: "complete",
      });

      expect(added?.truncated).toBe(true);
      expect(added?.conversation.messages[0]?.content.length).toBe(100);
      // Forced incomplete/"truncated" even though the caller claimed
      // "complete" -- the persisted record must never claim completeness it
      // cannot back up.
      expect(added?.conversation.messages[0]?.status).toBe("incomplete");
      expect(added?.conversation.messages[0]?.incompleteReason).toBe("truncated");

      // Item 10: the truncation must survive a fresh read, not just be
      // reflected in this call's own return value.
      const reloaded = await client.getConversation(conversation!.id);
      expect(reloaded?.messages[0]?.content.length).toBe(100);
      expect(reloaded?.messages[0]?.status).toBe("incomplete");
      expect(reloaded?.messages[0]?.incompleteReason).toBe("truncated");
    });

    it("also forces incomplete/truncated on updateMessageContent when the new content exceeds the ceiling", async () => {
      const client = createConversationStoreClient({
        store: new MemoryTestStore(),
        now: () => baseNow,
        idFactory: () => "conversation-1",
        limits: { maxMessageLength: 100 },
      });
      const conversation = await client.createConversation();
      await client.addMessage(conversation!.id, { id: "assistant-1", role: "assistant", content: "short" });

      const updated = await client.updateMessageContent(conversation!.id, "assistant-1", {
        content: "y".repeat(500),
        status: "complete",
      });

      expect(updated?.truncated).toBe(true);
      expect(updated?.conversation.messages[0]?.status).toBe("incomplete");
      expect(updated?.conversation.messages[0]?.incompleteReason).toBe("truncated");
      expect(updated?.conversation.messages[0]?.content.length).toBe(100);

      // Item 10: the truncation must survive a fresh read, not just be
      // reflected in this call's own return value.
      const reloaded = await client.getConversation(conversation!.id);
      expect(reloaded?.messages[0]?.content.length).toBe(100);
      expect(reloaded?.messages[0]?.status).toBe("incomplete");
      expect(reloaded?.messages[0]?.incompleteReason).toBe("truncated");
    });
  });
});

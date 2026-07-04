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
      expect(withMessage?.messageCount).toBe(1);
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

    expect(updated?.messageCount).toBe(2);
    expect(updated?.messages.map((message) => message.content)).toEqual(["private answer", "latest private prompt"]);
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
});

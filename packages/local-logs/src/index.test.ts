import { describe, expect, it } from "vitest";
import { addLocalLog, clearLocalLogs, createLocalLogsClient, getLocalLogs, pruneLocalLogs } from "./index";
import type { LocalLogInput, LocalLogRecord, LocalLogStore } from "./types";

class MemoryLocalLogStore implements LocalLogStore {
  records: LocalLogRecord[] = [];

  async add(record: LocalLogRecord): Promise<void> {
    this.records = [...this.records.filter((item) => item.id !== record.id), record];
  }

  async getAll(): Promise<LocalLogRecord[]> {
    return [...this.records];
  }

  async clear(): Promise<void> {
    this.records = [];
  }

  async delete(ids: string[]): Promise<void> {
    const idsToDelete = new Set(ids);
    this.records = this.records.filter((record) => !idsToDelete.has(record.id));
  }
}

class FailingLocalLogStore implements LocalLogStore {
  async add(): Promise<void> {
    throw new Error("storage failed");
  }

  async getAll(): Promise<LocalLogRecord[]> {
    throw new Error("storage failed");
  }

  async clear(): Promise<void> {
    throw new Error("storage failed");
  }

  async delete(): Promise<void> {
    throw new Error("storage failed");
  }
}

const baseNow = new Date("2026-07-04T10:00:00.000Z");

function createTestClient(store: LocalLogStore, maxLogs = 500) {
  let id = 0;
  return createLocalLogsClient({
    store,
    maxLogs,
    now: () => baseNow,
    idFactory: () => `log-${++id}`,
  });
}

describe("local logs", () => {
  it("stores a valid technical runtime event locally", async () => {
    const store = new MemoryLocalLogStore();
    const client = createTestClient(store);

    const record = await client.addLocalLog({
      event: "model.load.started",
      severity: "info",
      modelId: "sample-general-light",
      backend: "webgpu",
      runtimeStatus: "loading_model",
      deviceTier: 3,
      performanceMetrics: { loadTimeMs: 120, firstTokenMs: null },
    });

    expect(record).toEqual({
      id: "log-1",
      event: "model.load.started",
      severity: "info",
      timestamp: "2026-07-04T10:00:00.000Z",
      modelId: "sample-general-light",
      backend: "webgpu",
      runtimeStatus: "loading_model",
      deviceTier: 3,
      performanceMetrics: { loadTimeMs: 120, firstTokenMs: null },
    });
    await expect(client.getLocalLogs()).resolves.toEqual([record]);
  });

  it("removes forbidden prompt and response fields before storage", async () => {
    const store = new MemoryLocalLogStore();
    const client = createTestClient(store);
    const unsafeEvent = {
      event: "inference.completed",
      severity: "info",
      prompt: "private prompt",
      response: "private response",
      documentContent: "private document",
      fileContent: "private file",
      userText: "private user text",
      inputText: "private input text",
      outputText: "private output text",
      chatHistory: "private chat history",
    } as LocalLogInput;

    const record = await client.addLocalLog(unsafeEvent);
    const storedLogs = await client.getLocalLogs();
    const serialized = JSON.stringify(storedLogs);

    expect(record).toMatchObject({ event: "inference.completed", severity: "info" });
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("private response");
    expect(serialized).not.toContain("private document");
    expect(serialized).not.toContain("private file");
    expect(serialized).not.toContain("private user text");
    expect(serialized).not.toContain("private input text");
    expect(serialized).not.toContain("private output text");
    expect(serialized).not.toContain("private chat history");
    expect(storedLogs[0]).not.toHaveProperty("prompt");
    expect(storedLogs[0]).not.toHaveProperty("response");
  });

  it("rejects user content placed in allowed technical string fields", async () => {
    const store = new MemoryLocalLogStore();
    const client = createTestClient(store);

    const events = [
      { event: "Summarize this private uploaded document", severity: "info" },
      { event: "inference.failed", severity: "error", modelId: "the model for my private medical prompt" },
      { event: "inference.failed", severity: "error", errorCode: "The user asked a private question" },
    ] as LocalLogInput[];

    for (const event of events) {
      await expect(client.addLocalLog(event)).resolves.toBeNull();
    }

    await expect(client.getLocalLogs()).resolves.toEqual([]);
  });

  it("returns recent logs in descending timestamp order with a hard limit", async () => {
    const store = new MemoryLocalLogStore();
    const client = createLocalLogsClient({
      store,
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      idFactory: () => crypto.randomUUID(),
    });

    await client.addLocalLog({ event: "model.load.started", severity: "info", timestamp: "2026-07-04T10:00:00.000Z" });
    await client.addLocalLog({ event: "model.load.completed", severity: "info", timestamp: "2026-07-04T10:01:00.000Z" });
    await client.addLocalLog({ event: "inference.completed", severity: "info", timestamp: "2026-07-04T10:02:00.000Z" });

    await expect(client.getRecentLocalLogs(2)).resolves.toMatchObject([
      { event: "inference.completed" },
      { event: "model.load.completed" },
    ]);
  });

  it("prunes expired logs and excess old logs", async () => {
    const store = new MemoryLocalLogStore();
    const client = createLocalLogsClient({
      store,
      maxLogs: 2,
      maxAgeMs: 60 * 60 * 1000,
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      idFactory: () => crypto.randomUUID(),
    });

    await client.addLocalLog({ event: "model.load.started", severity: "info", timestamp: "2026-07-04T08:00:00.000Z" });
    await client.addLocalLog({ event: "model.load.completed", severity: "info", timestamp: "2026-07-04T09:30:00.000Z" });
    await client.addLocalLog({ event: "inference.started", severity: "info", timestamp: "2026-07-04T09:40:00.000Z" });
    await client.addLocalLog({ event: "inference.completed", severity: "info", timestamp: "2026-07-04T09:50:00.000Z" });

    await expect(client.getLocalLogs()).resolves.toMatchObject([
      { event: "inference.started" },
      { event: "inference.completed" },
    ]);
  });

  it("accepts the cancelling runtime status", async () => {
    const store = new MemoryLocalLogStore();
    const client = createTestClient(store);

    const record = await client.addLocalLog({
      event: "inference.cancel.requested",
      severity: "info",
      runtimeStatus: "cancelling",
    });

    expect(record).toMatchObject({ event: "inference.cancel.requested", runtimeStatus: "cancelling" });
  });

  it("clears stored logs", async () => {
    const store = new MemoryLocalLogStore();
    const client = createTestClient(store);

    await client.addLocalLog({ event: "model.load.started", severity: "info" });
    await client.clearLocalLogs();

    await expect(client.getLocalLogs()).resolves.toEqual([]);
  });

  it("is safe when IndexedDB is unavailable", async () => {
    await expect(addLocalLog({ event: "model.load.started", severity: "info" })).resolves.toBeNull();
    await expect(getLocalLogs()).resolves.toEqual([]);
    await expect(clearLocalLogs()).resolves.toBeUndefined();
    await expect(pruneLocalLogs()).resolves.toBe(0);
  });

  it("swallows storage errors and never throws into the app", async () => {
    const client = createTestClient(new FailingLocalLogStore());

    await expect(client.addLocalLog({ event: "model.load.started", severity: "info" })).resolves.toBeNull();
    await expect(client.getLocalLogs()).resolves.toEqual([]);
    await expect(client.clearLocalLogs()).resolves.toBeUndefined();
    await expect(client.pruneLocalLogs()).resolves.toBe(0);
  });
});

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { createModelBenchmarkStoreClient } from "./client";
import { MODEL_BENCHMARK_SCHEMA_VERSION, MODEL_BENCHMARK_VERSION } from "./constants";
import { createIndexedDbModelBenchmarkStore } from "./indexed-db-store";
import type { TrustedModelBenchmarkStore } from "./trusted-store";

// The open() phase of the IndexedDB adapter is abort-aware: a caller that
// gives up while `indexedDB.open()` is still pending must be released
// promptly, and whatever the abandoned request later does (succeed, upgrade,
// fail) must be inert. These tests drive the adapter through a CONTROLLED
// request double so every ordering is deterministic, plus one end-to-end run
// against fake-indexeddb.

const DB_NAME = "free-ai-open-model-benchmarks";
const STORE_NAME = "benchmarkResults";
const LIMITS = { maxTotal: 100, maxPerModel: 20 };

function buildResult(id: string): ModelBenchmarkResult {
  return {
    schemaVersion: MODEL_BENCHMARK_SCHEMA_VERSION,
    benchmarkVersion: MODEL_BENCHMARK_VERSION,
    id,
    modelId: "qwen3-4b-instruct-q4f16",
    model: {
      modelId: "qwen3-4b-instruct-q4f16",
      webllmModelId: "Qwen3-4B-Instruct-q4f16_1-MLC",
      registryVersion: "0.7.0-alpha.1",
    },
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: "2026-08-31T10:00:00.000Z",
    browserFamily: "chrome",
    capabilityProfileKey: "desktop:performance:webgpu:native",
    performanceMode: "performance",
    preset: "quick",
    runConfig: { contextPreset: "performance", contextWindowTokens: 4096, requestedOutputTokens: 512 },
    stage: "complete",
    outcome: "completed",
    load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: true, loadTimeMs: 1200 },
    firstToken: { firstTokenTimeMs: 350 },
    generation: {
      tokenCountConfidence: "exact",
      generationDurationMs: 4000,
      generatedTokenCount: 200,
      overallCompletionTokensPerSecond: 50,
    },
    environment: { webllmVersion: "0.2.84" },
  };
}

interface OpenRequestDouble {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  result: unknown;
  error: unknown;
  transaction: { abort: ReturnType<typeof vi.fn> } | null;
}

interface DatabaseDouble {
  objectStoreNames: { contains: ReturnType<typeof vi.fn> };
  createObjectStore: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  createIndex: ReturnType<typeof vi.fn>;
}

function createDatabaseDouble(): DatabaseDouble {
  const createIndex = vi.fn();
  return {
    objectStoreNames: { contains: vi.fn(() => false) },
    createObjectStore: vi.fn(() => ({ createIndex })),
    createIndex,
    close: vi.fn(),
    transaction: vi.fn(() => {
      throw new Error("no transaction may ever be created on an abandoned connection");
    }),
  };
}

function installFactoryDouble() {
  const requests: OpenRequestDouble[] = [];
  const open = vi.fn(() => {
    const request: OpenRequestDouble = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      result: undefined,
      error: null,
      transaction: null,
    };
    requests.push(request);
    return request;
  });
  vi.stubGlobal("indexedDB", { open });
  return { open, requests };
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IndexedDB open() honors AbortSignal", () => {
  it("never calls indexedDB.open() when the signal is already aborted", async () => {
    const { open } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();
    controller.abort();

    await expect(store.putAndPrune(buildResult("pre-aborted"), LIMITS, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(open).not.toHaveBeenCalled();
  });

  it("rejects PROMPTLY when aborted while open() is still pending, without waiting for the request", async () => {
    const { open, requests } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();

    const pending = store.putAndPrune(buildResult("abort-during-open"), LIMITS, { signal: controller.signal });
    expect(open).toHaveBeenCalledTimes(1);
    // The request double NEVER fires any event: the only way this settles is
    // through the abort path.
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requests[0]?.onsuccess).toBeTypeOf("function");
  });

  it("closes a connection that opens LATE for an abandoned caller, and never creates a transaction on it", async () => {
    const { requests } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();
    const pending = store.putAndPrune(buildResult("late-success"), LIMITS, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const database = createDatabaseDouble();
    const request = requests[0]!;
    request.result = database;
    request.onsuccess?.();

    expect(database.close).toHaveBeenCalledTimes(1);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("aborts a LATE upgrade for an abandoned caller instead of creating a schema", async () => {
    const { requests } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();
    const pending = store.putAndPrune(buildResult("late-upgrade"), LIMITS, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const database = createDatabaseDouble();
    const request = requests[0]!;
    request.result = database;
    request.transaction = { abort: vi.fn() };
    request.onupgradeneeded?.();

    expect(request.transaction.abort).toHaveBeenCalledTimes(1);
    expect(database.createObjectStore).not.toHaveBeenCalled();

    // The aborted upgrade then surfaces as an error event on the request;
    // for an abandoned caller that is inert (nothing to reject twice).
    request.error = abortError();
    expect(() => request.onerror?.()).not.toThrow();
  });

  it("still creates the schema when the caller is NOT abandoned, and delivers the connection", async () => {
    const { requests } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();
    const pending = store.putAndPrune(buildResult("normal-upgrade"), LIMITS, { signal: controller.signal });

    const database = createDatabaseDouble();
    const request = requests[0]!;
    request.result = database;
    request.transaction = { abort: vi.fn() };
    request.onupgradeneeded?.();

    expect(database.createObjectStore).toHaveBeenCalledTimes(1);
    expect(database.createIndex).toHaveBeenCalledTimes(2);
    expect(request.transaction.abort).not.toHaveBeenCalled();

    // Finish the open for a live caller, then abandon the transaction step:
    // the connection must still be closed by runTransaction's own cleanup.
    request.onsuccess?.();
    await expect(pending).rejects.toBeDefined(); // database.transaction() throws in the double
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it("an abort DURING an active upgrade (onupgradeneeded fired, success not yet) aborts the versionchange transaction IMMEDIATELY and rejects the caller", async () => {
    const { requests } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();
    const pending = store.putAndPrune(buildResult("abort-during-upgrade"), LIMITS, { signal: controller.signal });
    pending.catch(() => {});

    const database = createDatabaseDouble();
    const request = requests[0]!;
    request.result = database;
    request.transaction = { abort: vi.fn() };
    request.onupgradeneeded?.();
    // The upgrade ran for a live caller: the schema WAS created.
    expect(database.createObjectStore).toHaveBeenCalledTimes(1);
    expect(request.transaction.abort).not.toHaveBeenCalled();

    controller.abort();

    // Rolled back right now -- not on some later event that might commit first.
    expect(request.transaction.abort).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    // The aborted upgrade surfaces as an error event (inert) and a stray late
    // success closes the connection without ever creating a transaction.
    request.error = abortError();
    expect(() => request.onerror?.()).not.toThrow();
    request.onsuccess?.();
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("an abort whose versionchange transaction can no longer be aborted (already committing) is swallowed: the caller is still rejected and the late connection is closed inert", async () => {
    const { requests } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();
    const pending = store.putAndPrune(buildResult("abort-while-committing"), LIMITS, { signal: controller.signal });
    pending.catch(() => {});

    const database = createDatabaseDouble();
    const request = requests[0]!;
    request.result = database;
    request.transaction = {
      abort: vi.fn(() => {
        throw new Error("InvalidStateError");
      }),
    };
    request.onupgradeneeded?.();

    expect(() => controller.abort()).not.toThrow();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    request.onsuccess?.();
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("an abort BEFORE the upgrade begins has no transaction to abort yet; the later upgrade is then aborted by the upgrade handler", async () => {
    const { requests } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();
    const pending = store.putAndPrune(buildResult("abort-before-upgrade"), LIMITS, { signal: controller.signal });
    pending.catch(() => {});

    const request = requests[0]!;
    expect(request.transaction).toBeNull();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const database = createDatabaseDouble();
    request.result = database;
    request.transaction = { abort: vi.fn() };
    request.onupgradeneeded?.();
    expect(request.transaction.abort).toHaveBeenCalledTimes(1);
    expect(database.createObjectStore).not.toHaveBeenCalled();
  });

  it("an abort that arrives AFTER a successful open is harmless (the listener is detached)", async () => {
    const { requests } = installFactoryDouble();
    const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
    const controller = new AbortController();
    const pending = store.putAndPrune(buildResult("abort-after-open"), LIMITS, { signal: controller.signal });

    const database = createDatabaseDouble();
    requests[0]!.result = database;
    requests[0]!.onsuccess?.();
    await expect(pending).rejects.toBeDefined(); // transaction() throws in the double
    const closeCalls = database.close.mock.calls.length;

    expect(() => controller.abort()).not.toThrow();
    expect(database.close.mock.calls.length).toBe(closeCalls);
  });
});

describe("IndexedDB open() abort against a real (fake-indexeddb) database", () => {
  it("an abort issued while a FRESH database is still opening leaves no schema and no record, and does not poison later use", async () => {
    const hadIndexedDb = "indexedDB" in globalThis;
    const previous = hadIndexedDb ? globalThis.indexedDB : undefined;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
    const deleteDatabase = () =>
      new Promise<void>((resolve, reject) => {
        const request = fakeIndexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    await deleteDatabase();

    try {
      const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
      const client = createModelBenchmarkStoreClient({ store });
      const controller = new AbortController();

      // open() is invoked synchronously inside this call; abort before the
      // asynchronous open/upgrade events can run.
      const pending = client.recordResult(buildResult("aborted-fresh-db"), { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });

      // Let the abandoned open request (and its aborted upgrade) play out.
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Probe WITHOUT creating anything: if the abandoned open's upgrade had
      // committed, the database would already exist at this version and no
      // upgrade would run here. The probe aborts its own upgrade so it can
      // never leave a schema-less database behind.
      const probeUpgradeRan = await new Promise<boolean>((resolve) => {
        const request = fakeIndexedDB.open(DB_NAME, 1);
        let upgraded = false;
        request.onupgradeneeded = () => {
          upgraded = true;
          request.transaction?.abort();
        };
        request.onsuccess = () => {
          request.result.close();
          resolve(upgraded);
        };
        request.onerror = () => resolve(upgraded);
      });
      expect(probeUpgradeRan).toBe(true);

      // The rolled-back open did not poison the database: a normal write
      // afterwards upgrades it and persists exactly that one record.
      expect(await client.recordResult(buildResult("after-abort"))).toBe(true);
      expect((await client.listResults()).map((result) => result.id)).toEqual(["after-abort"]);
    } finally {
      await deleteDatabase();
      if (hadIndexedDb) {
        Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previous });
      } else {
        Reflect.deleteProperty(globalThis, "indexedDB");
      }
    }
  });

  it("an abort that fires AFTER onupgradeneeded created the schema but BEFORE open success ROLLS BACK the upgrade itself (schema and version)", async () => {
    const hadIndexedDb = "indexedDB" in globalThis;
    const previous = hadIndexedDb ? globalThis.indexedDB : undefined;
    const controller = new AbortController();
    let abortedAfterSchemaCreation = false;

    // A thin factory in front of fake-indexeddb whose only job is to fire the
    // abort at the exact moment between "the upgrade callback created the
    // schema" and "open succeeded".
    const interceptingFactory = {
      open(name: string, version?: number) {
        const request = fakeIndexedDB.open(name, version);
        queueMicrotask(() => {
          request.addEventListener("upgradeneeded", () => {
            // Deferred to a microtask so it lands after the WHOLE upgrade
            // event (including the adapter's own handler that creates the
            // schema) but before the transaction commits and open succeeds.
            queueMicrotask(() => {
              abortedAfterSchemaCreation = request.result.objectStoreNames.contains(STORE_NAME);
              controller.abort();
            });
          });
        });
        return request;
      },
    };
    const deleteDatabase = () =>
      new Promise<void>((resolve, reject) => {
        const request = fakeIndexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    await deleteDatabase();
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: interceptingFactory });

    try {
      const store = createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore;
      await expect(store.putAndPrune(buildResult("abort-mid-upgrade"), LIMITS, { signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
      // Guard against a vacuous test: the abort really did land after the
      // adapter's own upgrade handler had created the schema.
      expect(abortedAfterSchemaCreation).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 30));

      // Reopen the database normally. If the aborted upgrade had been
      // COMMITTED, it would already exist at version 1 with its object store
      // and no upgrade would run. A rolled-back upgrade means the database
      // is brand new again: old version 0 and no object stores.
      const probe = await new Promise<{ upgraded: boolean; oldVersion: number; storeNames: string[] }>((resolve) => {
        const request = fakeIndexedDB.open(DB_NAME, 1);
        const outcome = { upgraded: false, oldVersion: -1, storeNames: [] as string[] };
        request.onupgradeneeded = (event) => {
          outcome.upgraded = true;
          outcome.oldVersion = event.oldVersion;
          outcome.storeNames = Array.from(request.result.objectStoreNames);
          // Abort the probe's own upgrade so it can never leave a schema-less
          // version-1 database behind.
          request.transaction?.abort();
        };
        request.onsuccess = () => {
          request.result.close();
          resolve(outcome);
        };
        request.onerror = () => resolve(outcome);
      });
      expect(probe.upgraded).toBe(true);
      expect(probe.oldVersion).toBe(0);
      expect(probe.storeNames).toEqual([]);

      // And the rolled-back database is not poisoned for later use.
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
      const client = createModelBenchmarkStoreClient({ store: createIndexedDbModelBenchmarkStore() as TrustedModelBenchmarkStore });
      expect(await client.recordResult(buildResult("after-rollback"))).toBe(true);
      expect((await client.listResults()).map((result) => result.id)).toEqual(["after-rollback"]);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
      await deleteDatabase();
      if (hadIndexedDb) {
        Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previous });
      } else {
        Reflect.deleteProperty(globalThis, "indexedDB");
      }
    }
  });
});

import { IDBObjectStore as FakeIDBObjectStore, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { createModelBenchmarkStoreClient } from "./client";
import { createIndexedDbModelBenchmarkStore } from "./indexed-db-store";
import { createMemoryModelBenchmarkStore } from "./memory-store";
import type { ModelBenchmarkStore } from "./store";

function buildResult(overrides: Partial<ModelBenchmarkResult> = {}): ModelBenchmarkResult {
  return {
    schemaVersion: 1,
    benchmarkVersion: "1.0.0",
    id: overrides.id ?? `benchmark-${Math.random().toString(36).slice(2)}`,
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
      generationTokensPerSecond: 50,
    },
    environment: { webllmVersion: "0.2.84" },
    ...overrides,
  };
}

describe("ModelBenchmarkStoreClient (in-memory store)", () => {
  it("records a valid result and lists it back exactly", async () => {
    const client = createModelBenchmarkStoreClient({ store: createMemoryModelBenchmarkStore() });
    const result = buildResult({ id: "a" });

    expect(await client.recordResult(result)).toBe(true);
    const all = await client.listResults();
    expect(all).toEqual([result]);
  });

  it("rejects a malformed result without persisting it, and reports false rather than throwing", async () => {
    const client = createModelBenchmarkStoreClient({ store: createMemoryModelBenchmarkStore() });
    const malformed = { ...buildResult(), outcome: "not_a_real_outcome" } as unknown as ModelBenchmarkResult;

    await expect(client.recordResult(malformed)).resolves.toBe(false);
    expect(await client.listResults()).toEqual([]);
  });

  it("filters results by model, leaving other models' results untouched", async () => {
    const client = createModelBenchmarkStoreClient({ store: createMemoryModelBenchmarkStore() });
    await client.recordResult(buildResult({ id: "a1", modelId: "model-a", model: { modelId: "model-a", webllmModelId: "Model-A-MLC", registryVersion: "0.7.0-alpha.1" } }));
    await client.recordResult(buildResult({ id: "b1", modelId: "model-b", model: { modelId: "model-b", webllmModelId: "Model-B-MLC", registryVersion: "0.7.0-alpha.1" } }));

    const modelAResults = await client.listResultsForModel("model-a");
    expect(modelAResults).toHaveLength(1);
    expect(modelAResults[0]?.id).toBe("a1");
  });

  it("clearAll empties every model's history", async () => {
    const client = createModelBenchmarkStoreClient({ store: createMemoryModelBenchmarkStore() });
    await client.recordResult(buildResult({ id: "a" }));
    await client.clearAll();
    expect(await client.listResults()).toEqual([]);
  });

  it("clearForModel removes only that model's results, preserving every other model's history", async () => {
    const client = createModelBenchmarkStoreClient({ store: createMemoryModelBenchmarkStore() });
    await client.recordResult(buildResult({ id: "a1", modelId: "model-a", model: { modelId: "model-a", webllmModelId: "Model-A-MLC", registryVersion: "0.7.0-alpha.1" } }));
    await client.recordResult(buildResult({ id: "b1", modelId: "model-b", model: { modelId: "model-b", webllmModelId: "Model-B-MLC", registryVersion: "0.7.0-alpha.1" } }));

    await client.clearForModel("model-a");

    const remaining = await client.listResults();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("b1");
  });

  it("drops the oldest results for one model once its per-model cap is exceeded", async () => {
    const client = createModelBenchmarkStoreClient({ store: createMemoryModelBenchmarkStore() });
    // MAX_STORED_BENCHMARK_RESULTS_PER_MODEL is 20 -- write 22, oldest 2 by
    // createdAt should be dropped, leaving exactly 20 for this model.
    for (let index = 0; index < 22; index += 1) {
      await client.recordResult(
        buildResult({
          id: `run-${index}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          expiresAt: calculateExpiry(new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()),
        })
      );
    }

    const results = await client.listResultsForModel("qwen3-4b-instruct-q4f16");
    expect(results).toHaveLength(20);
    expect(results.map((result) => result.id)).not.toContain("run-0");
    expect(results.map((result) => result.id)).not.toContain("run-1");
    expect(results.map((result) => result.id)).toContain("run-21");
  });
});

// Local re-implementation of the same 30-day TTL formula as expiry.ts, kept
// separate on purpose: this test wants to prove that whatever
// sanitizeModelBenchmarkResult() itself considers a valid expiresAt (not an
// assumption baked into this test file) keeps working across many
// createdAt values, so it recomputes the same 30-day window rather than
// importing the implementation and risking the two silently agreeing on a
// mistake.
function calculateExpiry(createdAt: string): string {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1_000;
  return new Date(Date.parse(createdAt) + thirtyDaysMs).toISOString();
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const FAKE_DB_NAME = "free-ai-open-model-benchmarks";
const FAKE_STORE_NAME = "benchmarkResults";

async function withFakeIndexedDb(test: () => Promise<void>): Promise<void> {
  const hadIndexedDb = "indexedDB" in globalThis;
  const previousIndexedDb = hadIndexedDb ? globalThis.indexedDB : undefined;

  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fakeIndexedDB });
  await requestToPromise(fakeIndexedDB.deleteDatabase(FAKE_DB_NAME));

  try {
    await test();
  } finally {
    await requestToPromise(fakeIndexedDB.deleteDatabase(FAKE_DB_NAME));
    if (hadIndexedDb) {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previousIndexedDb });
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
}

describe("ModelBenchmarkStoreClient (real IndexedDB via fake-indexeddb)", () => {
  it("persists core operations through IndexedDB", async () => {
    await withFakeIndexedDb(async () => {
      const store = createIndexedDbModelBenchmarkStore() as ModelBenchmarkStore;
      expect(store).not.toBeNull();
      const client = createModelBenchmarkStoreClient({ store });

      const result = buildResult({ id: "indexeddb-1" });
      expect(await client.recordResult(result)).toBe(true);

      const all = await client.listResults();
      expect(all).toEqual([result]);

      await client.clearAll();
      expect(await client.listResults()).toEqual([]);
    });
  });

  it("migration/read-time re-validation: a corrupted record already in the backend is silently dropped on read, never thrown", async () => {
    await withFakeIndexedDb(async () => {
      // Simulate a record written by a since-changed schema (or corrupted
      // in storage) by inserting it directly into the raw IndexedDB object
      // store, bypassing ModelBenchmarkStoreClient AND the store adapter's
      // own write-time sanitization entirely. That bypass is intentional
      // here: it is the only way such a record could exist today, since
      // every sanctioned write path (recordResult -> putAndPrune) now
      // rejects it outright -- see memory-store.ts/indexed-db-store.ts's
      // own "defense in depth" comments.
      const store = createIndexedDbModelBenchmarkStore() as ModelBenchmarkStore;
      expect(store).not.toBeNull();
      const client = createModelBenchmarkStoreClient({ store });
      await client.recordResult(buildResult({ id: "valid" }));

      const database = await requestToPromise(fakeIndexedDB.open(FAKE_DB_NAME));
      const transaction = database.transaction(FAKE_STORE_NAME, "readwrite");
      await requestToPromise(
        transaction.objectStore(FAKE_STORE_NAME).put({ ...buildResult({ id: "corrupt" }), schemaVersion: 999 })
      );
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();

      const results = await client.listResults();
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("valid");
    });
  });

  it("rejects when a write request succeeds but its transaction is then aborted before completion -- request-level success must never be mistaken for durable persistence", async () => {
    await withFakeIndexedDb(async () => {
      const originalPut = FakeIDBObjectStore.prototype.put;
      let requestSucceeded = false;
      let transactionAborted = false;
      let abortEventFired: Promise<void> | undefined;

      // Simulates a transaction that aborts AFTER one of its requests has
      // already reported success (e.g. a later request in the same
      // transaction failing, or a quota error). This drives the REAL
      // public persistence path (ModelBenchmarkStoreClient -> putAndPrune
      // -> runTransaction) rather than a hand-rolled reimplementation of
      // it -- only put() is intercepted, and only to force an abort once
      // its own request has already succeeded. `addEventListener` (never
      // `request.onsuccess =`) is used here so this listener coexists
      // with runTransaction's own `requestToPromise()` (which does set
      // `request.onsuccess`) instead of clobbering it; it fires first
      // because it is registered first. Calling `abort()` flips the
      // transaction to inactive synchronously, but the "abort" DOM event
      // itself is dispatched on a later task -- after (not before) the
      // rejection this produces already propagates through
      // ModelBenchmarkStoreClient.recordResult() -- so the event is
      // captured as its own promise and awaited separately below, rather
      // than asserted immediately after the rejection.
      FakeIDBObjectStore.prototype.put = function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore["put"]>
      ): IDBRequest<IDBValidKey> {
        const request = originalPut.apply(this, args);
        const transaction = this.transaction;
        request.addEventListener("success", () => {
          requestSucceeded = true;
          abortEventFired = new Promise((resolve) => {
            transaction.addEventListener("abort", () => {
              transactionAborted = true;
              resolve();
            });
          });
          transaction.abort();
        });
        return request;
      };

      try {
        const store = createIndexedDbModelBenchmarkStore() as ModelBenchmarkStore;
        expect(store).not.toBeNull();
        const client = createModelBenchmarkStoreClient({ store });

        const result = buildResult({ id: "aborted-after-request-success" });
        // MUST NOT resolve successfully merely because the underlying
        // request already fired `onsuccess` -- the public write operation
        // has to reject once its transaction never actually commits.
        await expect(client.recordResult(result)).rejects.toBeDefined();

        // The request itself really did report success -- proving this
        // is not merely a case where the write never got that far.
        expect(requestSucceeded).toBe(true);
        await abortEventFired;
        expect(transactionAborted).toBe(true);

        // No partial persisted result is observable after the aborted
        // transaction: the request "succeeding" must never be mistaken
        // for the write actually landing durably.
        const all = await client.listResults();
        expect(all).toEqual([]);
      } finally {
        FakeIDBObjectStore.prototype.put = originalPut;
      }
    });
  });

  it("retains atomic put+prune behavior: a per-model history cap enforced through the real IndexedDB backend still leaves exactly the newest allowed results", async () => {
    await withFakeIndexedDb(async () => {
      const store = createIndexedDbModelBenchmarkStore() as ModelBenchmarkStore;
      expect(store).not.toBeNull();
      const client = createModelBenchmarkStoreClient({ store });

      for (let index = 0; index < 22; index += 1) {
        const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
        expect(
          await client.recordResult(
            buildResult({ id: `idb-run-${index}`, createdAt, expiresAt: calculateExpiry(createdAt) })
          )
        ).toBe(true);
      }

      const results = await client.listResultsForModel("qwen3-4b-instruct-q4f16");
      expect(results).toHaveLength(20);
      expect(results.map((result) => result.id)).not.toContain("idb-run-0");
      expect(results.map((result) => result.id)).not.toContain("idb-run-1");
      expect(results.map((result) => result.id)).toContain("idb-run-21");
    });
  });
});

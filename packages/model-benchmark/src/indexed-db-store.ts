import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { computeModelBenchmarkIdsToPrune } from "./pruning";
import type { ModelBenchmarkStore } from "./store";
import { sanitizeModelBenchmarkResult } from "./validation";

const DB_NAME = "free-ai-open-model-benchmarks";
const DB_VERSION = 1;
const STORE_NAME = "benchmarkResults";

function getIndexedDb(): IDBFactory | null {
  return typeof globalThis !== "undefined" && "indexedDB" in globalThis ? globalThis.indexedDB : null;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  const request = indexedDb.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("modelId", "modelId");
      store.createIndex("createdAt", "createdAt");
    }
  };

  return requestToPromise(request);
}

// Runs `operation` against the object store and resolves only once the
// ENCLOSING transaction reaches "complete" -- never merely once the
// operation's own last request fired `onsuccess`. A request succeeding
// only means the browser accepted that one write into the transaction; it
// does not mean the transaction's changes were actually committed
// (durably applied) yet. Rejects on the transaction's own "abort"/"error"
// event too, so a failure partway through (e.g. a quota error on a later
// request within the same operation) is never silently treated as success.
async function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const indexedDb = getIndexedDb();
  if (!indexedDb) throw new Error("IndexedDB is not available");

  const database = await openDatabase(indexedDb);
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    const transactionCompleted = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    });

    const [result] = await Promise.all([operation(store), transactionCompleted]);
    return result;
  } finally {
    database.close();
  }
}

// Inserts `result` and enforces the per-model/global history caps within
// the SAME readwrite transaction as the insert itself -- see
// docs/architecture.md's "IndexedDB transaction atomicity" section. There
// is no intermediate state observable from outside this function where the
// insert has happened but pruning has not (or vice versa): the whole
// transaction commits together (runTransaction resolves only after
// `transaction.oncomplete`), or none of it does.
async function putAndPruneInTransaction(
  store: IDBObjectStore,
  result: ModelBenchmarkResult,
  limits: Parameters<ModelBenchmarkStore["putAndPrune"]>[1]
): Promise<void> {
  await requestToPromise(store.put(result));

  const allRecords = (await requestToPromise(store.getAll())) as ModelBenchmarkResult[];
  const idsToDelete = computeModelBenchmarkIdsToPrune(allRecords, result.modelId, limits);
  for (const id of idsToDelete) {
    await requestToPromise(store.delete(id));
  }
}

// INTERNAL implementation detail -- not exported from this package's public
// index (see index.ts's own comment). ModelBenchmarkStoreClient is the only
// sanctioned public entry point for persistence; this adapter still
// sanitizes every write itself as defense in depth (never relying on
// TypeScript structural typing alone to keep an unsanitized object out of
// storage) and always persists the freshly-constructed sanitized object,
// never the caller's own input reference. See docs/security.md's "Local
// model benchmarking" section.
export function createIndexedDbModelBenchmarkStore(): ModelBenchmarkStore | null {
  if (!getIndexedDb()) return null;

  return {
    async putAndPrune(result, limits) {
      const sanitized = sanitizeModelBenchmarkResult(result);
      if (!sanitized) throw new Error("Cannot persist an invalid ModelBenchmarkResult");
      await runTransaction("readwrite", (store) => putAndPruneInTransaction(store, sanitized, limits));
    },
    async get(id: string) {
      return runTransaction("readonly", async (store) => {
        const result = await requestToPromise(store.get(id));
        return (result as ModelBenchmarkResult | undefined) ?? null;
      });
    },
    async getAll() {
      return runTransaction("readonly", async (store) => requestToPromise(store.getAll()) as Promise<ModelBenchmarkResult[]>);
    },
    async delete(id) {
      await runTransaction("readwrite", async (store) => {
        await requestToPromise(store.delete(id));
      });
    },
    async clear() {
      await runTransaction("readwrite", async (store) => {
        await requestToPromise(store.clear());
      });
    },
    async clearForModel(modelId) {
      await runTransaction("readwrite", async (store) => {
        const index = store.index("modelId");
        const keys = await requestToPromise(index.getAllKeys(IDBKeyRange.only(modelId)));
        for (const key of keys) {
          await requestToPromise(store.delete(key));
        }
      });
    },
  };
}

import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { computeModelBenchmarkIdsToPrune } from "./pruning";
import type { ModelBenchmarkStore } from "./store";
import type { ModelBenchmarkStoreWriteOptions } from "./store";
import { markTrustedBackend } from "./trusted-store";
import type { TrustedModelBenchmarkStore } from "./trusted-store";
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

// Opens the database, honoring `signal` for the WHOLE open -- not just the
// transaction that follows it. An `open()` request can stay pending for a
// long time (another tab holding an older version open, a slow browser
// profile), and a caller that has already given up must neither be kept
// waiting on it nor be left with a live connection it never asked for:
//
// - an already-aborted signal never calls `indexedDb.open()` at all;
// - an abort while the request is pending rejects the caller PROMPTLY with
//   an AbortError and ABANDONS the request;
// - when an abandoned request later succeeds, its connection is closed
//   immediately and no transaction is ever created on it (inert);
// - an abort that arrives WHILE an upgrade is in progress (onupgradeneeded
//   already fired, success has not) aborts the versionchange transaction
//   immediately, so the schema/version change is rolled back rather than
//   committed behind the caller's back;
// - when an abandoned request later reaches `onupgradeneeded`, the upgrade
//   transaction is aborted too, so no schema is created for a caller that is
//   gone (the database rolls back to its previous version and a later open
//   simply upgrades again).
function openDatabase(indexedDb: IDBFactory, signal?: AbortSignal): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    // `answered`: the caller has been resolved or rejected exactly once.
    // `abandoned`: the caller gave up (abort) while the request was pending.
    let answered = false;
    let abandoned = false;

    const request = indexedDb.open(DB_NAME, DB_VERSION);

    const abortUpgradeTransaction = () => {
      // `request.transaction` is non-null ONLY while a versionchange (upgrade)
      // transaction exists. Aborting it rolls the whole version change back --
      // schema and version -- so an abandoned caller can never leave a
      // committed upgrade behind. A transaction that already finished or is
      // committing throws InvalidStateError; it is then past the point where
      // anything can be rolled back and nothing more is owed.
      try {
        request.transaction?.abort();
      } catch {
        // Already committing/finished.
      }
    };

    const onAbort = () => {
      if (answered) return;
      answered = true;
      abandoned = true;
      // Roll back an upgrade that is ALREADY in progress right now, rather
      // than waiting for a later event that may commit it first.
      abortUpgradeTransaction();
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const detach = () => signal?.removeEventListener("abort", onAbort);

    request.onupgradeneeded = () => {
      if (abandoned) {
        // The caller left BEFORE the upgrade began: abort it instead of
        // creating a schema for nobody.
        abortUpgradeTransaction();
        return;
      }
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("modelId", "modelId");
        store.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => {
      detach();
      const database = request.result;
      if (abandoned) {
        // Late success for a caller that already left: close the connection
        // and never create a transaction on it.
        database.close();
        return;
      }
      answered = true;
      resolve(database);
    };

    request.onerror = () => {
      detach();
      if (answered) return;
      answered = true;
      reject(request.error);
    };
  });
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
  operation: (store: IDBObjectStore) => Promise<T>,
  options: ModelBenchmarkStoreWriteOptions = {}
): Promise<T> {
  const indexedDb = getIndexedDb();
  if (!indexedDb) throw new Error("IndexedDB is not available");
  if (options.signal?.aborted) throw createAbortError();

  const database = await openDatabase(indexedDb, options.signal);
  if (options.signal?.aborted) {
    database.close();
    throw createAbortError();
  }
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    const transactionSettled = new Promise<{ ok: true } | { ok: false; error: unknown }>((resolve) => {
      transaction.oncomplete = () => resolve({ ok: true });
      transaction.onabort = () => resolve({ ok: false, error: transaction.error ?? createAbortError() });
      transaction.onerror = () => resolve({ ok: false, error: transaction.error ?? new Error("IndexedDB transaction failed") });
    });

    const abortTransaction = () => {
      try {
        transaction.abort();
      } catch {
        // A transaction which already completed/aborted is already
        // quiescent; its terminal event below remains authoritative.
      }
    };
    options.signal?.addEventListener("abort", abortTransaction, { once: true });
    if (options.signal?.aborted) abortTransaction();

    const operationSettled = Promise.resolve()
      .then(() => operation(store))
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

    const [operationOutcome, transactionOutcome] = await Promise.all([
      operationSettled,
      transactionSettled,
    ]);
    options.signal?.removeEventListener("abort", abortTransaction);

    if (!transactionOutcome.ok) throw transactionOutcome.error;
    if (!operationOutcome.ok) throw operationOutcome.error;
    return operationOutcome.value;
  } finally {
    database.close();
  }
}

function createAbortError(): Error {
  const error = new Error("IndexedDB transaction aborted");
  error.name = "AbortError";
  return error;
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
  limits: Parameters<ModelBenchmarkStore["putAndPrune"]>[1],
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw createAbortError();
  await requestToPromise(store.put(result));

  if (signal?.aborted) throw createAbortError();

  const allRecords = (await requestToPromise(store.getAll())) as ModelBenchmarkResult[];
  const idsToDelete = computeModelBenchmarkIdsToPrune(allRecords, result.modelId, limits);
  for (const id of idsToDelete) {
    if (signal?.aborted) throw createAbortError();
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
//
// TRUSTED backend (see trusted-store.ts): the AbortSignal is honored from
// open() onward -- a pre-aborted signal never opens the database, an abort
// during a pending open or an in-progress upgrade rolls it back, a late open
// success is closed inert, and once a transaction exists the signal aborts it
// and its terminal event is awaited before the write settles.
export function createIndexedDbModelBenchmarkStore(): TrustedModelBenchmarkStore | null {
  if (!getIndexedDb()) return null;

  return markTrustedBackend({
    async putAndPrune(result, limits, options = {}) {
      const sanitized = sanitizeModelBenchmarkResult(result);
      if (!sanitized) throw new Error("Cannot persist an invalid ModelBenchmarkResult");
      await runTransaction(
        "readwrite",
        (store) => putAndPruneInTransaction(store, sanitized, limits, options.signal),
        options
      );
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
  });
}

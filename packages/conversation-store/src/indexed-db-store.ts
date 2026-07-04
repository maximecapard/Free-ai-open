import type { Conversation, ConversationId, ConversationStore } from "./types";

const DB_NAME = "free-ai-open-conversations";
const DB_VERSION = 1;
const STORE_NAME = "conversations";

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
      store.createIndex("createdAt", "createdAt");
      store.createIndex("updatedAt", "updatedAt");
    }
  };

  return requestToPromise(request);
}

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
    return await operation(store);
  } finally {
    database.close();
  }
}

export function createIndexedDbConversationStore(): ConversationStore | null {
  if (!getIndexedDb()) return null;

  return {
    async put(conversation) {
      await runTransaction("readwrite", async (store) => {
        await requestToPromise(store.put(conversation));
      });
    },
    async get(id: ConversationId) {
      return runTransaction("readonly", async (store) => {
        const result = await requestToPromise(store.get(id));
        return (result as Conversation | undefined) ?? null;
      });
    },
    async getAll() {
      return runTransaction("readonly", async (store) => requestToPromise(store.getAll()) as Promise<Conversation[]>);
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
  };
}

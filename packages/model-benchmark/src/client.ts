import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { MAX_STORED_BENCHMARK_RESULTS, MAX_STORED_BENCHMARK_RESULTS_PER_MODEL } from "./constants";
import { createIndexedDbModelBenchmarkStore } from "./indexed-db-store";
import { createMemoryModelBenchmarkStore } from "./memory-store";
import type { ModelBenchmarkStore } from "./store";
import { sanitizeModelBenchmarkResult } from "./validation";

export interface ModelBenchmarkStoreClientOptions {
  store?: ModelBenchmarkStore | null;
}

// Mirrors @free-ai-open/conversation-store's ConversationStoreClient shape:
// a thin wrapper around a swappable ModelBenchmarkStore that owns
// validation-on-write and migration/re-validation-on-read, so neither the
// IndexedDB backend nor the in-memory fallback needs to know about either.
// History-cap enforcement lives in the backend itself (via putAndPrune),
// not here, so insert-and-prune stays one atomic operation per backend --
// see store.ts's own comment and docs/architecture.md's "IndexedDB
// transaction atomicity" section.
export class ModelBenchmarkStoreClient {
  private readonly store: ModelBenchmarkStore;

  constructor(options: ModelBenchmarkStoreClientOptions = {}) {
    this.store = options.store ?? createIndexedDbModelBenchmarkStore() ?? createMemoryModelBenchmarkStore();
  }

  // Validates `result` before ever reaching the backend -- a caller that
  // somehow constructs a malformed ModelBenchmarkResult (or passes through
  // untrusted data) gets a clean `false` rather than corrupt data silently
  // landing in storage. Returns whether the write actually happened.
  async recordResult(result: ModelBenchmarkResult): Promise<boolean> {
    const sanitized = sanitizeModelBenchmarkResult(result);
    if (!sanitized) return false;
    await this.store.putAndPrune(sanitized, {
      maxTotal: MAX_STORED_BENCHMARK_RESULTS,
      maxPerModel: MAX_STORED_BENCHMARK_RESULTS_PER_MODEL,
    });
    return true;
  }

  // Migration/version strategy: every read re-validates each stored record
  // through sanitizeModelBenchmarkResult(), silently dropping anything that
  // no longer matches the current schema (a future schemaVersion bump,
  // storage corruption, or a record written by a since-removed field)
  // rather than throwing or surfacing partially-typed data -- the same
  // philosophy as @free-ai-open/conversation-store and
  // apps/web/app/_lib/modelObservationStore.ts. Always returned oldest
  // first (by createdAt), matching conversation-store's own ordering
  // convention.
  async listResults(): Promise<ModelBenchmarkResult[]> {
    const all = await this.store.getAll();
    return all
      .map((result) => sanitizeModelBenchmarkResult(result))
      .filter((result): result is ModelBenchmarkResult => result !== null)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  async listResultsForModel(modelId: string): Promise<ModelBenchmarkResult[]> {
    const all = await this.listResults();
    return all.filter((result) => result.modelId === modelId);
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
  }

  async clearForModel(modelId: string): Promise<void> {
    await this.store.clearForModel(modelId);
  }
}

const defaultClient = new ModelBenchmarkStoreClient();

export function createModelBenchmarkStoreClient(options: ModelBenchmarkStoreClientOptions = {}): ModelBenchmarkStoreClient {
  return new ModelBenchmarkStoreClient(options);
}

export function recordModelBenchmarkResult(result: ModelBenchmarkResult): Promise<boolean> {
  return defaultClient.recordResult(result);
}

export function listModelBenchmarkResults(): Promise<ModelBenchmarkResult[]> {
  return defaultClient.listResults();
}

export function listModelBenchmarkResultsForModel(modelId: string): Promise<ModelBenchmarkResult[]> {
  return defaultClient.listResultsForModel(modelId);
}

export function clearModelBenchmarkResults(): Promise<void> {
  return defaultClient.clearAll();
}

export function clearModelBenchmarkResultsForModel(modelId: string): Promise<void> {
  return defaultClient.clearForModel(modelId);
}

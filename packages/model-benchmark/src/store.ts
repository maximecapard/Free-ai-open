import type { ModelBenchmarkResult } from "@free-ai-open/types";

// The per-model / global caps `putAndPrune` enforces atomically alongside
// the insert itself -- passed in by ModelBenchmarkStoreClient (which owns
// the actual constant values, see constants.ts) rather than hardcoded in
// each backend, so both backends enforce whatever limits the client
// currently configures.
export interface ModelBenchmarkHistoryLimits {
  maxTotal: number;
  maxPerModel: number;
}

// The storage backend contract ModelBenchmarkStoreClient drives -- mirrors
// @free-ai-open/conversation-store's ConversationStore shape so both
// packages follow one recognizable pattern: a thin, swappable backend
// (IndexedDB in the browser, in-memory for SSR/tests) behind a single
// interface, with all validation handled one layer up in the client.
//
// `putAndPrune` (rather than a separate `put` + a client-driven
// delete-the-excess pass) exists so insert-and-enforce-history-cap is a
// single atomic operation from the caller's point of view: a backend must
// never expose a state where the new record was written but excess
// records were not yet pruned, or vice versa (see
// docs/architecture.md's "IndexedDB transaction atomicity" section). The
// IndexedDB backend implements this as one readwrite transaction; the
// in-memory backend is trivially atomic since it never yields mid-mutation.
export interface ModelBenchmarkStore {
  putAndPrune(result: ModelBenchmarkResult, limits: ModelBenchmarkHistoryLimits): Promise<void>;
  get(id: string): Promise<ModelBenchmarkResult | null>;
  getAll(): Promise<ModelBenchmarkResult[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  clearForModel(modelId: string): Promise<void>;
}

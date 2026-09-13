// Public API surface for @free-ai-open/model-benchmark. Deliberately
// narrow: raw storage adapters (indexed-db-store.ts, memory-store.ts) and
// the ModelBenchmarkStore backend type are intentionally NOT exported here.
// Consumers -- including the future router integration -- must go through
// ModelBenchmarkStoreClient (or the free functions below), the only path
// that guarantees every write is sanitized/normalized before persistence.
// Exporting the raw adapters would let a caller bypass that boundary
// entirely (e.g. `store.putAndPrune(rawUserObject, limits)` with no
// validation in between) -- see docs/privacy.md's "Local model
// benchmarking" section. Within this package, tests and client.ts still
// reach the adapters via their own relative imports; that is an internal
// implementation detail, not part of the public contract.
export {
  MAX_STORED_BENCHMARK_RESULTS,
  MAX_STORED_BENCHMARK_RESULTS_PER_MODEL,
  MODEL_BENCHMARK_DEFAULT_TTL_MS,
  MODEL_BENCHMARK_SCHEMA_VERSION,
  MODEL_BENCHMARK_VERSION,
} from "./constants";
export { classifyModelBenchmarkStability } from "./stability";
export type { ModelBenchmarkStabilityClass } from "./stability";
export {
  filterUsableModelBenchmarkResults,
  isModelBenchmarkResultCompatible,
  isModelBenchmarkResultExpired,
  isModelBenchmarkResultUsable,
} from "./compatibility";
export type { ModelBenchmarkCompatibilityContext } from "./compatibility";
export { calculateModelBenchmarkExpiry } from "./expiry";
export { MODEL_BENCHMARK_EVIDENCE_THRESHOLDS, summarizeModelBenchmarkEvidence } from "./evidence";
export type { BenchmarkEvidenceSummary, ModelBenchmarkEvidenceLevel } from "./evidence";
export { sanitizeModelBenchmarkResult } from "./validation";
export {
  ModelBenchmarkStoreClient,
  clearModelBenchmarkResults,
  clearModelBenchmarkResultsForModel,
  createModelBenchmarkStoreClient,
  listModelBenchmarkResults,
  listModelBenchmarkResultsForModel,
  recordModelBenchmarkResult,
} from "./client";
export type { ModelBenchmarkStoreClientOptions } from "./client";

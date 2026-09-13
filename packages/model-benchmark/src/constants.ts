// v0.8.0-alpha "Local Benchmarks & Performance Intelligence" — Phase 0.
//
// A semver-like version stamped onto every persisted
// @free-ai-open/types#ModelBenchmarkResult, independent of this package's
// own package.json version. Bumped only when the MEANING of a measurement
// changes (e.g. a different first-token boundary or preset definition),
// never on every code change — mirrors
// @free-ai-open/local-benchmark's own LOCAL_BENCHMARK_VERSION convention
// exactly, kept as a separate constant because these are unrelated
// benchmarks (see benchmark-signals.ts's own top comment).
export const MODEL_BENCHMARK_VERSION = "1.0.0";

// The schema version sanitizeModelBenchmarkResult() currently accepts. A
// stored record from a different schemaVersion is dropped on read rather
// than coerced — see validation.ts and docs/architecture.md's "Benchmark
// persistence and migration" section for the exact strategy (silently
// drop, never throw, never guess at a shape that has changed).
export const MODEL_BENCHMARK_SCHEMA_VERSION = 1;

// How long a persisted result remains usable evidence before it is treated
// as stale even when nothing about the model/registry/runtime changed —
// device drivers, browser updates, and thermal/background conditions all
// drift over weeks. Mirrors the spirit of
// @free-ai-open/model-router's own OBSERVATION_MAX_AGE_MS (30 days)
// without importing it (this package does not depend on model-router —
// see docs/architecture.md's "Package boundaries" section).
export const MODEL_BENCHMARK_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

// Keeps local history useful without growing unbounded, mirroring
// @free-ai-open/conversation-store's capped-history approach and
// model-router's MAX_ROUTER_OBSERVATIONS: oldest results are dropped first.
// The per-model cap exists so one frequently-re-benchmarked model can never
// crowd out every other model's history within the same global cap.
export const MAX_STORED_BENCHMARK_RESULTS = 100;
export const MAX_STORED_BENCHMARK_RESULTS_PER_MODEL = 20;

import { MODEL_BENCHMARK_DEFAULT_TTL_MS } from "./constants";

// The single canonical formula for how long a ModelBenchmarkResult remains
// usable evidence: exactly createdAt + MODEL_BENCHMARK_DEFAULT_TTL_MS, never
// something a caller (or a forged/corrupted stored record) gets to choose
// independently. sanitizeModelBenchmarkResult() requires a persisted
// `expiresAt` to equal this EXACTLY -- not merely "not later than" -- so
// there is exactly one way to compute a valid value and no way to construct
// a result that claims to remain valid indefinitely (see
// docs/architecture.md's "Benchmark persistence and migration" section).
// `expiresAt` stays a persisted field on the type itself (rather than being
// removed and always recomputed by every reader) so the contract shape is
// unchanged and any reader can still filter directly on it without also
// needing createdAt -- but this function is the only legitimate way to
// produce that value.
export function calculateModelBenchmarkExpiry(createdAt: string): string {
  return new Date(Date.parse(createdAt) + MODEL_BENCHMARK_DEFAULT_TTL_MS).toISOString();
}

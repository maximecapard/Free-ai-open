import type { ModelPerformanceObservation } from "@free-ai-open/types";

// v0.7.0-alpha "Adaptive Model Router v1" contract (Phase 0: persistence
// shape and migration only — @free-ai-open/ai-runtime does not record real
// observations yet; see docs/roadmap.md). Technical timings and an outcome
// code only, never prompt/response content — see docs/privacy.md.
const STORAGE_KEY = "free-ai-open:model-performance-observations";
const SCHEMA_VERSION = 1;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,159}$/;
const MAX_TIMING_MS = 24 * 60 * 60 * 1_000;
const MAX_TOKEN_RATE = 100_000;
const MAX_CONTEXT_TOKENS = 10_000_000;

// Keeps local history useful for future routing decisions without growing
// unbounded; oldest observations are dropped first, mirroring
// @free-ai-open/conversation-store's own capped-history approach.
const MAX_OBSERVATIONS = 200;

const VALID_OUTCOMES = new Set([
  "completed",
  "cancelled",
  "stalled",
  "degenerate",
  "out_of_memory",
  "device_lost",
  "load_failed",
]);

function asOptionalMetric(value: unknown, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : undefined;
}

function sanitizeObservation(value: unknown): ModelPerformanceObservation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof candidate.modelId !== "string" || !MODEL_ID_PATTERN.test(candidate.modelId)) return null;
  if (typeof candidate.observedAt !== "string" || !Number.isFinite(Date.parse(candidate.observedAt))) return null;
  if (typeof candidate.loadSucceeded !== "boolean") return null;
  if (typeof candidate.outcome !== "string" || !VALID_OUTCOMES.has(candidate.outcome)) return null;

  const observation: ModelPerformanceObservation = {
    schemaVersion: SCHEMA_VERSION,
    modelId: candidate.modelId,
    observedAt: candidate.observedAt,
    loadSucceeded: candidate.loadSucceeded,
    outcome: candidate.outcome as ModelPerformanceObservation["outcome"],
  };
  const metrics = {
    loadTimeMs: asOptionalMetric(candidate.loadTimeMs, MAX_TIMING_MS),
    firstTokenTimeMs: asOptionalMetric(candidate.firstTokenTimeMs, MAX_TIMING_MS),
    promptTokensPerSecond: asOptionalMetric(candidate.promptTokensPerSecond, MAX_TOKEN_RATE),
    generationTokensPerSecond: asOptionalMetric(candidate.generationTokensPerSecond, MAX_TOKEN_RATE),
    generationDurationMs: asOptionalMetric(candidate.generationDurationMs, MAX_TIMING_MS),
    testedContextTokens: asOptionalMetric(candidate.testedContextTokens, MAX_CONTEXT_TOKENS),
  } satisfies Partial<ModelPerformanceObservation>;
  for (const [key, metric] of Object.entries(metrics)) {
    if (metric !== undefined) {
      (observation as unknown as Record<string, unknown>)[key] = metric;
    }
  }
  return observation;
}

// Pure migration function: silently drops entries that don't match the
// current schema version/shape rather than discarding the whole history or
// throwing on a single corrupted or future-schema record.
export function migrateModelPerformanceObservations(raw: unknown): ModelPerformanceObservation[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeObservation).filter((observation): observation is ModelPerformanceObservation => observation !== null);
}

export function getStoredModelPerformanceObservations(): ModelPerformanceObservation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return migrateModelPerformanceObservations(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeObservations(observations: ModelPerformanceObservation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(observations.slice(-MAX_OBSERVATIONS)));
  } catch {
    // Storage may be unavailable (private browsing, quota, disabled).
  }
}

export function recordModelPerformanceObservation(observation: ModelPerformanceObservation): void {
  const sanitized = sanitizeObservation({ ...observation, schemaVersion: SCHEMA_VERSION });
  if (!sanitized) return;
  const current = getStoredModelPerformanceObservations();
  writeObservations([...current, sanitized]);
}

export function clearStoredModelPerformanceObservations(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

import type { ModelPerformanceObservation } from "@free-ai-open/types";

// v0.7.0-alpha "Adaptive Model Router v1" contract (Phase 0: persistence
// shape and migration only — @free-ai-open/ai-runtime does not record real
// observations yet; see docs/roadmap.md). Technical timings and an outcome
// code only, never prompt/response content — see docs/privacy.md.
const STORAGE_KEY = "free-ai-open:model-performance-observations";
const SCHEMA_VERSION = 1;

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

function isValidObservation(value: unknown): value is ModelPerformanceObservation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  return (
    candidate.schemaVersion === SCHEMA_VERSION &&
    typeof candidate.modelId === "string" &&
    typeof candidate.observedAt === "string" &&
    typeof candidate.loadSucceeded === "boolean" &&
    typeof candidate.outcome === "string" &&
    VALID_OUTCOMES.has(candidate.outcome)
  );
}

// Pure migration function: silently drops entries that don't match the
// current schema version/shape rather than discarding the whole history or
// throwing on a single corrupted or future-schema record.
export function migrateModelPerformanceObservations(raw: unknown): ModelPerformanceObservation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidObservation);
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
  const current = getStoredModelPerformanceObservations();
  writeObservations([...current, { ...observation, schemaVersion: SCHEMA_VERSION }]);
}

export function clearStoredModelPerformanceObservations(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

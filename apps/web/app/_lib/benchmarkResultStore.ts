import type { LocalBenchmarkResult } from "@free-ai-open/types";

// v0.7.0-alpha "Adaptive Model Router v1" contract (Phase 0: persistence
// shape and migration only — no benchmark workload exists yet; see
// docs/roadmap.md). Never transmitted anywhere; see docs/privacy.md.
const STORAGE_KEY = "free-ai-open:local-benchmark-result";
const SCHEMA_VERSION = 1;

function isBenchmarkStatus(value: unknown): value is LocalBenchmarkResult["status"] {
  return value === "completed" || value === "cancelled" || value === "failed" || value === "unsupported";
}

function isStability(value: unknown): value is LocalBenchmarkResult["stability"] {
  return value === "unknown" || value === "stable" || value === "degraded" || value === "failed";
}

function isCapabilityConfidence(value: unknown): value is LocalBenchmarkResult["confidence"] {
  return value === "low" || value === "medium" || value === "high";
}

export function migrateLocalBenchmarkResult(raw: unknown): LocalBenchmarkResult | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof candidate.benchmarkVersion !== "string") return null;
  if (typeof candidate.measuredAt !== "string" || typeof candidate.expiresAt !== "string") return null;
  if (!isBenchmarkStatus(candidate.status)) return null;
  if (!isStability(candidate.stability)) return null;
  if (!isCapabilityConfidence(candidate.confidence)) return null;

  return candidate as unknown as LocalBenchmarkResult;
}

// A migrated result whose expiresAt has already passed is treated as absent
// by getStoredLocalBenchmarkResult rather than handed to a caller as if
// still current — the caller decides whether/when to re-benchmark.
export function isLocalBenchmarkResultExpired(
  result: LocalBenchmarkResult,
  now: () => Date = () => new Date()
): boolean {
  return Date.parse(result.expiresAt) <= now().getTime();
}

export function getStoredLocalBenchmarkResult(now: () => Date = () => new Date()): LocalBenchmarkResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const migrated = migrateLocalBenchmarkResult(JSON.parse(raw));
    if (!migrated || isLocalBenchmarkResultExpired(migrated, now)) return null;
    return migrated;
  } catch {
    return null;
  }
}

export function setStoredLocalBenchmarkResult(result: LocalBenchmarkResult): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...result, schemaVersion: SCHEMA_VERSION }));
  } catch {
    // Storage may be unavailable (private browsing, quota, disabled).
  }
}

export function clearStoredLocalBenchmarkResult(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

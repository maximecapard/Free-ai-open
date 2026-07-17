import type { LocalBenchmarkResult } from "@free-ai-open/types";
import {
  buildCapabilityProfileKey,
  LOCAL_BENCHMARK_SCHEMA_VERSION,
  LOCAL_BENCHMARK_VERSION,
} from "@free-ai-open/local-benchmark";
import type { StaticCapabilityProfile } from "@free-ai-open/types";

// v0.7.0-alpha "Adaptive Model Router v1" contract (Phase 0: persistence
// shape and migration only — no benchmark workload exists yet; see
// docs/roadmap.md). Never transmitted anywhere; see docs/privacy.md.
const STORAGE_KEY = "free-ai-open:local-benchmark-result";
const SCHEMA_VERSION = LOCAL_BENCHMARK_SCHEMA_VERSION;
const ERROR_CODES = new Set<NonNullable<LocalBenchmarkResult["errorCode"]>>([
  "webgpu_unavailable", "adapter_request_failed", "device_request_failed", "invalid_compute_result",
  "out_of_memory", "device_lost", "timeout", "cancelled", "background_throttled", "worker_failed", "unknown",
]);

function isBenchmarkStatus(value: unknown): value is LocalBenchmarkResult["status"] {
  return value === "completed" || value === "cancelled" || value === "failed" || value === "unsupported";
}

function isStability(value: unknown): value is LocalBenchmarkResult["stability"] {
  return value === "unknown" || value === "stable" || value === "degraded" || value === "failed";
}

function isCapabilityConfidence(value: unknown): value is LocalBenchmarkResult["confidence"] {
  return value === "low" || value === "medium" || value === "high";
}

function isResponsiveness(value: unknown): value is LocalBenchmarkResult["responsiveness"] {
  return value === "unknown" || value === "responsive" || value === "degraded" || value === "poor";
}

function isStage(value: unknown): value is LocalBenchmarkResult["stage"] {
  return value === "initialization" || value === "warmup" || value === "compute" || value === "validation" || value === "complete";
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function optionalNumber(candidate: Record<string, unknown>, key: string): number | undefined {
  return typeof candidate[key] === "number" ? candidate[key] : undefined;
}

export function migrateLocalBenchmarkResult(raw: unknown): LocalBenchmarkResult | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== SCHEMA_VERSION) return null;
  if (candidate.benchmarkVersion !== LOCAL_BENCHMARK_VERSION) return null;
  if (typeof candidate.capabilityProfileKey !== "string" || candidate.capabilityProfileKey.length > 100) return null;
  if (typeof candidate.measuredAt !== "string" || Number.isNaN(Date.parse(candidate.measuredAt))) return null;
  if (typeof candidate.expiresAt !== "string" || Number.isNaN(Date.parse(candidate.expiresAt))) return null;
  if (!isBenchmarkStatus(candidate.status)) return null;
  if (!isStage(candidate.stage)) return null;
  if (!isStability(candidate.stability)) return null;
  if (!isResponsiveness(candidate.responsiveness)) return null;
  if (!isCapabilityConfidence(candidate.confidence)) return null;
  for (const key of ["webgpuInitMs", "computeScore", "medianComputeMs", "sampleCount", "mainThreadDelayMs", "durationMs"]) {
    if (!isOptionalNonNegativeNumber(candidate[key])) return null;
  }

  const result: LocalBenchmarkResult = {
    schemaVersion: SCHEMA_VERSION,
    benchmarkVersion: LOCAL_BENCHMARK_VERSION,
    capabilityProfileKey: candidate.capabilityProfileKey,
    measuredAt: candidate.measuredAt,
    expiresAt: candidate.expiresAt,
    status: candidate.status as LocalBenchmarkResult["status"],
    stage: candidate.stage as LocalBenchmarkResult["stage"],
    responsiveness: candidate.responsiveness as LocalBenchmarkResult["responsiveness"],
    stability: candidate.stability as LocalBenchmarkResult["stability"],
    confidence: candidate.confidence as LocalBenchmarkResult["confidence"],
  };
  for (const key of ["webgpuInitMs", "computeScore", "medianComputeMs", "sampleCount", "mainThreadDelayMs", "durationMs"] as const) {
    const value = optionalNumber(candidate, key);
    if (value !== undefined) result[key] = value;
  }
  if (candidate.timingMethod === "wall-clock" || candidate.timingMethod === "gpu-timestamp") result.timingMethod = candidate.timingMethod;
  if (typeof candidate.errorCode === "string" && ERROR_CODES.has(candidate.errorCode as NonNullable<LocalBenchmarkResult["errorCode"]>)) {
    result.errorCode = candidate.errorCode as LocalBenchmarkResult["errorCode"];
  }
  return result;
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

export function getStoredLocalBenchmarkForProfile(
  profile: StaticCapabilityProfile,
  now: () => Date = () => new Date()
): LocalBenchmarkResult | null {
  const result = getStoredLocalBenchmarkResult(now);
  return result?.capabilityProfileKey === buildCapabilityProfileKey(profile) ? result : null;
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

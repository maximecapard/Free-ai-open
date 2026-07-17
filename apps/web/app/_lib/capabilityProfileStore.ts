import type { StaticCapabilityProfile } from "@free-ai-open/types";

// v0.7.0-alpha "Adaptive Model Router v1" contract (Phase 0: persistence
// shape and migration only — no detector populates real capability data
// yet; see docs/roadmap.md). Persists only the already-coarse
// StaticCapabilityProfile shape: raw GPU adapter strings and exact
// high-entropy limit maps must never reach this store — see
// "Persistence boundaries" in docs/architecture.md and docs/privacy.md.
// Follows the same window-guarded/try-catch localStorage convention as
// gettingStartedPreference.ts.
const STORAGE_KEY = "free-ai-open:capability-profile";
const SCHEMA_VERSION = 1;

function isCapabilityConfidence(value: unknown): value is StaticCapabilityProfile["confidence"] {
  return value === "low" || value === "medium" || value === "high";
}

function isFormFactor(value: unknown): value is StaticCapabilityProfile["formFactor"] {
  return value === "mobile" || value === "tablet" || value === "desktop" || value === "unknown";
}

function isArchitectureClass(value: unknown): value is StaticCapabilityProfile["architectureClass"] {
  return value === "arm" || value === "x86" || value === "unknown";
}

function isGpuShape(value: unknown): value is StaticCapabilityProfile["gpu"] {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.featureClasses) &&
    typeof candidate.limitClasses === "object" &&
    candidate.limitClasses !== null
  );
}

// Pure migration function: validates an arbitrary parsed JSON value against
// the current schema version and shape, returning null for anything that
// doesn't match (a future schema bump, corrupted data, or an unrelated
// value) rather than trusting it blindly.
export function migrateStaticCapabilityProfile(raw: unknown): StaticCapabilityProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof candidate.detectedAt !== "string") return null;
  if (!isFormFactor(candidate.formFactor)) return null;
  if (!isArchitectureClass(candidate.architectureClass)) return null;
  if (typeof candidate.browserFamily !== "string" || typeof candidate.osFamily !== "string") return null;
  if (typeof candidate.webgpuAvailable !== "boolean" || typeof candidate.wasmAvailable !== "boolean") return null;
  if (!isGpuShape(candidate.gpu)) return null;
  if (!isCapabilityConfidence(candidate.confidence)) return null;

  return candidate as unknown as StaticCapabilityProfile;
}

export function getStoredCapabilityProfile(): StaticCapabilityProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateStaticCapabilityProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function setStoredCapabilityProfile(profile: StaticCapabilityProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...profile, schemaVersion: SCHEMA_VERSION }));
  } catch {
    // Storage may be unavailable (private browsing, quota, disabled).
  }
}

export function clearStoredCapabilityProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

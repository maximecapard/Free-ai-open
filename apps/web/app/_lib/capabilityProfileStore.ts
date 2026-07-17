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
const SCHEMA_VERSION = 2;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const GPU_LIMIT_CLASSES = new Set(["low", "medium", "high", "very_high", "unknown"]);

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
  const rawLikeKeys = ["vendorString", "deviceString", "driverString", "deviceId", "driver", "rawDescription"];
  if (rawLikeKeys.some((key) => Object.prototype.hasOwnProperty.call(candidate, key))) return false;
  return (
    Array.isArray(candidate.featureClasses) &&
    typeof candidate.limitClasses === "object" &&
    candidate.limitClasses !== null
  );
}

function isMemoryClass(value: unknown): value is StaticCapabilityProfile["memoryClass"] {
  return value === "low" || value === "medium" || value === "high" || value === "unknown";
}

function isCapabilityClass(value: unknown): value is StaticCapabilityProfile["capabilityClass"] {
  return value === "compatibility" || value === "light" || value === "balanced" || value === "performance";
}

function isDeviceTier(value: unknown): value is StaticCapabilityProfile["deviceTier"] {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

function classifyMemory(value: unknown): StaticCapabilityProfile["memoryClass"] {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "unknown";
  if (value < 4) return "low";
  if (value < 8) return "medium";
  return "high";
}

function classifyProcessor(value: unknown): StaticCapabilityProfile["logicalProcessorClass"] {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "unknown";
  if (value <= 4) return "low";
  if (value <= 8) return "medium";
  return "high";
}

function capabilityClassForTier(tier: StaticCapabilityProfile["deviceTier"]): StaticCapabilityProfile["capabilityClass"] {
  if (tier === 0) return "compatibility";
  if (tier === 1) return "light";
  if (tier === 2) return "balanced";
  return "performance";
}

function addDefaultExpiry(detectedAt: string): string {
  const time = Date.parse(detectedAt);
  const source = Number.isNaN(time) ? 0 : time;
  return new Date(source + MAX_AGE_MS).toISOString();
}

function sanitizeLimitClasses(value: unknown): StaticCapabilityProfile["gpu"]["limitClasses"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: StaticCapabilityProfile["gpu"]["limitClasses"] = {};
  for (const [key, limitClass] of Object.entries(value)) {
    if (GPU_LIMIT_CLASSES.has(String(limitClass))) {
      result[key] = limitClass as StaticCapabilityProfile["gpu"]["limitClasses"][string];
    } else if (typeof limitClass === "number") {
      result[key] = "unknown";
    }
  }
  return result;
}

function normalizeGpu(candidate: Record<string, unknown>): StaticCapabilityProfile["gpu"] | null {
  if (!isGpuShape(candidate.gpu)) return null;
  const gpu = candidate.gpu as Record<string, unknown>;
  return {
    ...(typeof gpu.vendorClass === "string" ? { vendorClass: gpu.vendorClass as StaticCapabilityProfile["gpu"]["vendorClass"] } : {}),
    ...(typeof gpu.architectureClass === "string"
      ? { architectureClass: gpu.architectureClass as StaticCapabilityProfile["gpu"]["architectureClass"] }
      : {}),
    ...(typeof gpu.descriptionClass === "string"
      ? { descriptionClass: gpu.descriptionClass as StaticCapabilityProfile["gpu"]["descriptionClass"] }
      : {}),
    featureClasses: (gpu.featureClasses as unknown[]).filter((item): item is string => typeof item === "string").sort(),
    limitClasses: sanitizeLimitClasses(gpu.limitClasses),
    ...(typeof gpu.experimentalMemoryClass === "string"
      ? { experimentalMemoryClass: gpu.experimentalMemoryClass as StaticCapabilityProfile["gpu"]["experimentalMemoryClass"] }
      : {}),
    ...(gpu.experimentalMemoryConfidence === "low" ? { experimentalMemoryConfidence: "low" as const } : {}),
  };
}

// Pure migration function: validates an arbitrary parsed JSON value against
// the current schema version and shape, returning null for anything that
// doesn't match (a future schema bump, corrupted data, or an unrelated
// value) rather than trusting it blindly.
export function migrateStaticCapabilityProfile(raw: unknown): StaticCapabilityProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof candidate.detectedAt !== "string") return null;
  if (!isFormFactor(candidate.formFactor)) return null;
  if (!isArchitectureClass(candidate.architectureClass)) return null;
  if (typeof candidate.browserFamily !== "string" || typeof candidate.osFamily !== "string") return null;
  if (typeof candidate.webgpuAvailable !== "boolean" || typeof candidate.wasmAvailable !== "boolean") return null;
  const gpu = normalizeGpu(candidate);
  if (!gpu) return null;
  if (!isCapabilityConfidence(candidate.confidence)) return null;

  const deviceTier = isDeviceTier(candidate.deviceTier) ? candidate.deviceTier : candidate.webgpuAvailable ? 1 : 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    detectedAt: candidate.detectedAt,
    expiresAt: typeof candidate.expiresAt === "string" ? candidate.expiresAt : addDefaultExpiry(candidate.detectedAt),
    formFactor: candidate.formFactor,
    architectureClass: candidate.architectureClass,
    browserFamily: candidate.browserFamily,
    osFamily: candidate.osFamily,
    memoryClass: isMemoryClass(candidate.memoryClass) ? candidate.memoryClass : classifyMemory(candidate.approximateMemoryGB),
    logicalProcessorClass: isMemoryClass(candidate.logicalProcessorClass)
      ? candidate.logicalProcessorClass
      : classifyProcessor(candidate.logicalProcessors),
    ...(typeof candidate.approximateMemoryGB === "number" ? { approximateMemoryGB: candidate.approximateMemoryGB } : {}),
    ...(typeof candidate.logicalProcessors === "number" ? { logicalProcessors: candidate.logicalProcessors } : {}),
    webgpuAvailable: candidate.webgpuAvailable,
    wasmAvailable: candidate.wasmAvailable,
    ...(typeof candidate.fallbackAdapter === "boolean" ? { fallbackAdapter: candidate.fallbackAdapter } : {}),
    capabilityClass: isCapabilityClass(candidate.capabilityClass) ? candidate.capabilityClass : capabilityClassForTier(deviceTier),
    deviceTier,
    gpu,
    confidence: candidate.confidence,
  };
}

export function isCapabilityProfileExpired(
  profile: StaticCapabilityProfile,
  now: () => Date = () => new Date()
): boolean {
  return Date.parse(profile.expiresAt) <= now().getTime();
}

export function shouldRedetectCapabilityProfile(
  profile: StaticCapabilityProfile | null,
  context: { browserFamily?: string; osFamily?: string; now?: () => Date } = {}
): boolean {
  if (!profile) return true;
  if (isCapabilityProfileExpired(profile, context.now)) return true;
  if (context.browserFamily && context.browserFamily !== profile.browserFamily) return true;
  if (context.osFamily && context.osFamily !== profile.osFamily) return true;
  return false;
}

export function getStoredCapabilityProfile(now: () => Date = () => new Date()): StaticCapabilityProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const migrated = migrateStaticCapabilityProfile(JSON.parse(raw));
    if (!migrated || isCapabilityProfileExpired(migrated, now)) return null;
    return migrated;
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

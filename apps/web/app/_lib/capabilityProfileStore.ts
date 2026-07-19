import {
  browserFamilies,
  experimentalMemoryClasses,
  gpuArchitectureClasses,
  gpuDescriptionClasses,
  gpuFeatureClasses,
  gpuLimitClasses,
  gpuLimitKeys,
  gpuVendorClasses,
  osFamilies,
} from "@free-ai-open/types";
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
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const BROWSER_FAMILIES = new Set<string>(browserFamilies);
const OS_FAMILIES = new Set<string>(osFamilies);
const GPU_VENDOR_CLASSES = new Set<string>(gpuVendorClasses);
const GPU_ARCHITECTURE_CLASSES = new Set<string>(gpuArchitectureClasses);
const GPU_DESCRIPTION_CLASSES = new Set<string>(gpuDescriptionClasses);
const GPU_FEATURE_CLASSES = new Set<string>(gpuFeatureClasses);
const GPU_LIMIT_KEYS = new Set<string>(gpuLimitKeys);
const GPU_LIMIT_CLASSES = new Set<string>(gpuLimitClasses);
const EXPERIMENTAL_MEMORY_CLASSES = new Set<string>(experimentalMemoryClasses);

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
  return new Date(time + MAX_AGE_MS).toISOString();
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isOptionalBoundedNumber(value: unknown, maximum: number): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum);
}

function sanitizeLimitClasses(value: unknown): StaticCapabilityProfile["gpu"]["limitClasses"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: StaticCapabilityProfile["gpu"]["limitClasses"] = {};
  for (const [key, limitClass] of Object.entries(value)) {
    if (!GPU_LIMIT_KEYS.has(key)) continue;
    if (typeof limitClass === "string" && GPU_LIMIT_CLASSES.has(limitClass)) {
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
  const vendorClass = typeof gpu.vendorClass === "string" && GPU_VENDOR_CLASSES.has(gpu.vendorClass)
    ? gpu.vendorClass as StaticCapabilityProfile["gpu"]["vendorClass"]
    : undefined;
  const architectureClass = typeof gpu.architectureClass === "string" && GPU_ARCHITECTURE_CLASSES.has(gpu.architectureClass)
    ? gpu.architectureClass as StaticCapabilityProfile["gpu"]["architectureClass"]
    : undefined;
  const descriptionClass = typeof gpu.descriptionClass === "string" && GPU_DESCRIPTION_CLASSES.has(gpu.descriptionClass)
    ? gpu.descriptionClass as StaticCapabilityProfile["gpu"]["descriptionClass"]
    : undefined;
  const experimentalMemoryClass =
    typeof gpu.experimentalMemoryClass === "string" && EXPERIMENTAL_MEMORY_CLASSES.has(gpu.experimentalMemoryClass)
      ? gpu.experimentalMemoryClass as StaticCapabilityProfile["gpu"]["experimentalMemoryClass"]
      : undefined;
  return {
    ...(vendorClass ? { vendorClass } : {}),
    ...(architectureClass ? { architectureClass } : {}),
    ...(descriptionClass ? { descriptionClass } : {}),
    featureClasses: (gpu.featureClasses as unknown[])
      .filter((item): item is string => typeof item === "string" && GPU_FEATURE_CLASSES.has(item))
      .sort(),
    limitClasses: sanitizeLimitClasses(gpu.limitClasses),
    ...(experimentalMemoryClass ? { experimentalMemoryClass } : {}),
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
  if (!isIsoDate(candidate.detectedAt)) return null;
  if (!isFormFactor(candidate.formFactor)) return null;
  if (!isArchitectureClass(candidate.architectureClass)) return null;
  if (typeof candidate.browserFamily !== "string" || !BROWSER_FAMILIES.has(candidate.browserFamily)) return null;
  if (typeof candidate.osFamily !== "string" || !OS_FAMILIES.has(candidate.osFamily)) return null;
  if (typeof candidate.webgpuAvailable !== "boolean" || typeof candidate.wasmAvailable !== "boolean") return null;
  const gpu = normalizeGpu(candidate);
  if (!gpu) return null;
  if (!isCapabilityConfidence(candidate.confidence)) return null;
  if (!isOptionalBoundedNumber(candidate.approximateMemoryGB, 1024)) return null;
  if (!isOptionalBoundedNumber(candidate.logicalProcessors, 1024)) return null;

  const expiresAt = candidate.expiresAt === undefined ? addDefaultExpiry(candidate.detectedAt) : candidate.expiresAt;
  if (!isIsoDate(expiresAt) || Date.parse(expiresAt) <= Date.parse(candidate.detectedAt)) return null;

  const deviceTier = isDeviceTier(candidate.deviceTier) ? candidate.deviceTier : candidate.webgpuAvailable ? 1 : 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    detectedAt: candidate.detectedAt,
    expiresAt,
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
  const detectedAt = Date.parse(profile.detectedAt);
  const expiresAt = Date.parse(profile.expiresAt);
  const currentTime = now().getTime();
  return !Number.isFinite(detectedAt) || !Number.isFinite(expiresAt) ||
    expiresAt <= detectedAt || expiresAt <= currentTime || detectedAt > currentTime + MAX_CLOCK_SKEW_MS;
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
    const sanitized = migrateStaticCapabilityProfile({ ...profile, schemaVersion: SCHEMA_VERSION });
    if (!sanitized) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
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

import type { DeviceTier, PerformanceMode } from "@free-ai-open/types";

// A single focused local preference store for the first-run "Getting
// Started" flow: whether it has been completed, the performance mode the
// user confirmed, and just enough device context to explain that choice
// later (never raw/identifying values — see docs/privacy.md). Stored as one
// JSON object under one key, versioned for future migration, following the
// same window-guarded/try-catch localStorage convention as
// themePreference.ts and localePreference.ts.
const STORAGE_KEY = "free-ai-open:getting-started";
const SCHEMA_VERSION = 1;

export interface GettingStartedDeviceSnapshot {
  deviceTier: DeviceTier;
  webgpuAvailable: boolean;
  formFactor: string;
}

export interface GettingStartedState {
  schemaVersion: number;
  completed: boolean;
  performanceMode: PerformanceMode | null;
  device: GettingStartedDeviceSnapshot | null;
}

const DEFAULT_STATE: GettingStartedState = {
  schemaVersion: SCHEMA_VERSION,
  completed: false,
  performanceMode: null,
  device: null,
};

function isPerformanceModeValue(value: unknown): value is PerformanceMode {
  return value === "fast" || value === "balanced" || value === "performance";
}

function isDeviceSnapshot(value: unknown): value is GettingStartedDeviceSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.deviceTier === "number" &&
    typeof candidate.webgpuAvailable === "boolean" &&
    typeof candidate.formFactor === "string"
  );
}

function parseState(raw: string | null): GettingStartedState {
  if (!raw) return DEFAULT_STATE;

  try {
    const parsed = JSON.parse(raw) as Partial<GettingStartedState> | null;
    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== SCHEMA_VERSION) return DEFAULT_STATE;

    return {
      schemaVersion: SCHEMA_VERSION,
      completed: parsed.completed === true,
      performanceMode: isPerformanceModeValue(parsed.performanceMode) ? parsed.performanceMode : null,
      device: isDeviceSnapshot(parsed.device) ? parsed.device : null,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(state: GettingStartedState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable (private browsing, quota, disabled). Getting
    // Started will simply be shown again next visit rather than blocking use.
  }
}

export function getGettingStartedState(): GettingStartedState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_STATE;
  }
}

export function isGettingStartedCompleted(): boolean {
  return getGettingStartedState().completed;
}

export function getStoredPerformanceMode(): PerformanceMode | null {
  return getGettingStartedState().performanceMode;
}

export function completeGettingStarted(
  performanceMode: PerformanceMode,
  device?: GettingStartedDeviceSnapshot | null
): void {
  writeState({
    schemaVersion: SCHEMA_VERSION,
    completed: true,
    performanceMode,
    device: device ?? null,
  });
}

export function setStoredPerformanceMode(performanceMode: PerformanceMode): void {
  writeState({ ...getGettingStartedState(), performanceMode });
}

export function resetGettingStarted(): void {
  writeState(DEFAULT_STATE);
}

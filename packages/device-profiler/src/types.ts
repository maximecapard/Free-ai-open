import type { Backend, DeviceTier } from "@free-ai-open/types";

export type DeviceTierLabel = "cpu_only" | "webgpu_low" | "webgpu_medium" | "webgpu_high" | "desktop_power";

// Coarse, non-identifying capability categories. These are deliberately
// bucketed (not raw sensor/API values) so the profile can never act as a
// unique hardware fingerprint. See docs/privacy.md.
export type FormFactor = "mobile" | "tablet" | "desktop" | "unknown";
export type ArchitectureClass = "arm" | "x86" | "unknown";
export type MemoryClass = "low" | "medium" | "high" | "unknown";
export type CpuConcurrencyClass = "low" | "medium" | "high" | "unknown";

export interface StorageEstimateLike {
  quota?: number;
}

export interface StorageManagerLike {
  estimate?: () => Promise<StorageEstimateLike>;
}

export interface UserAgentDataLike {
  platform?: string;
  brands?: Array<{ brand: string }>;
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

export interface NavigatorLike {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  gpu?: {
    requestAdapter?: () => Promise<unknown>;
  };
  storage?: StorageManagerLike;
  userAgent?: string;
  userAgentData?: UserAgentDataLike;
}

// Real, locally-measured runtime performance. Nothing here is invented: every
// field is optional and, today, callers simply omit it. This is the clean
// integration point for a future caller (e.g. apps/web reading its own
// recent @free-ai-open/local-logs history) to let real performance promote
// or demote a device's tier instead of relying on coarse signals alone. See
// "Future router integration" in docs/architecture.md.
export interface MeasuredPerformanceSample {
  modelLoadTimeMs?: number;
  firstTokenTimeMs?: number;
  tokensPerSecond?: number;
  recentFailureCount?: number;
}

export interface DeviceProfilerEnvironment {
  navigator?: NavigatorLike;
  webAssemblyAvailable?: boolean;
  measuredPerformance?: MeasuredPerformanceSample;
}

export interface BrowserInfo {
  browserFamily: string;
  osFamily: string;
}

export interface LightweightBenchmarkResult {
  status: "skipped";
  score: null;
  reason: "placeholder";
}

export interface DeviceTierInput {
  webgpuAvailable: boolean;
  wasmAvailable: boolean;
  estimatedMemoryGb?: number;
  storageQuotaGb?: number;
  formFactor?: FormFactor;
  cpuConcurrency?: number;
  measuredPerformance?: MeasuredPerformanceSample;
}

export interface DeviceTierInfo {
  tier: DeviceTier;
  label: DeviceTierLabel;
}

export interface DeviceProfile {
  webgpuAvailable: boolean;
  wasmAvailable: boolean;
  preferredBackend: Backend;
  estimatedMemoryGb?: number;
  storageQuotaGb?: number;
  browserFamily: string;
  osFamily: string;
  benchmark: LightweightBenchmarkResult;
  deviceTier: DeviceTier;
  deviceTierLabel: DeviceTierLabel;
  formFactor: FormFactor;
  architectureClass: ArchitectureClass;
  memoryClass: MemoryClass;
  cpuConcurrencyClass: CpuConcurrencyClass;
  measuredPerformance?: MeasuredPerformanceSample;
}

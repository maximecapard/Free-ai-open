import type { Backend, DeviceTier } from "@free-ai-open/types";

export type DeviceTierLabel = "cpu_only" | "webgpu_low" | "webgpu_medium" | "webgpu_high" | "desktop_power";

export interface StorageEstimateLike {
  quota?: number;
}

export interface StorageManagerLike {
  estimate?: () => Promise<StorageEstimateLike>;
}

export interface NavigatorLike {
  deviceMemory?: number;
  gpu?: {
    requestAdapter?: () => Promise<unknown>;
  };
  storage?: StorageManagerLike;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
    brands?: Array<{ brand: string }>;
  };
}

export interface DeviceProfilerEnvironment {
  navigator?: NavigatorLike;
  webAssemblyAvailable?: boolean;
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
}

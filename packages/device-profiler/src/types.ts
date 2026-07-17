import type {
  ArchitectureClass,
  Backend,
  CapabilityClass,
  DeviceTier,
  ExperimentalMemoryClass,
  FormFactor,
  GpuArchitectureClass,
  GpuDescriptionClass,
  GpuLimitClass,
  GpuVendorClass,
  LogicalProcessorClass,
  MemoryClass,
  StaticCapabilityProfile,
} from "@free-ai-open/types";

export type DeviceTierLabel = "cpu_only" | "webgpu_low" | "webgpu_medium" | "webgpu_high" | "desktop_power";

// FormFactor/ArchitectureClass now live in @free-ai-open/types (v0.7's
// StaticCapabilityProfile contract needs them too) and are re-exported here
// so every existing `import type { FormFactor } from "@free-ai-open/device-
// profiler"` call site keeps working unchanged. Coarse, non-identifying
// capability categories, deliberately bucketed (not raw sensor/API values)
// so the profile can never act as a unique hardware fingerprint. See
// docs/privacy.md.
export type { ArchitectureClass, FormFactor };
export type {
  CapabilityClass,
  ExperimentalMemoryClass,
  GpuArchitectureClass,
  GpuDescriptionClass,
  GpuLimitClass,
  GpuVendorClass,
  LogicalProcessorClass,
  MemoryClass,
  StaticCapabilityProfile,
};
export type CpuConcurrencyClass = LogicalProcessorClass;

export type GpuFeatureClass =
  | "shader-f16"
  | "timestamp-query"
  | "texture-compression-bc"
  | "texture-compression-etc2"
  | "texture-compression-astc"
  | "subgroups"
  | "storage-textures"
  | "unknown";

export interface GpuInfoLike {
  vendor?: unknown;
  architecture?: unknown;
  device?: unknown;
  description?: unknown;
  memoryHeaps?: unknown;
  memoryHeapSize?: unknown;
  memorySize?: unknown;
}

export interface GpuAdapterLike {
  info?: GpuInfoLike;
  requestAdapterInfo?: () => Promise<GpuInfoLike>;
  isFallbackAdapter?: boolean;
  features?: Iterable<unknown> | { forEach?: (callback: (value: unknown) => void) => void };
  limits?: Record<string, unknown>;
  memoryInfo?: unknown;
}

export interface NormalizedGpuProfile {
  vendorClass: GpuVendorClass;
  architectureClass: GpuArchitectureClass;
  descriptionClass: GpuDescriptionClass;
  featureClasses: GpuFeatureClass[];
  limitClasses: Record<string, GpuLimitClass>;
  fallbackAdapter?: boolean;
  experimentalMemoryClass?: ExperimentalMemoryClass;
  experimentalMemoryConfidence?: "low";
}

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
  fallbackAdapter?: boolean;
  gpuFeatureClasses?: string[];
  gpuLimitClasses?: Record<string, GpuLimitClass>;
  experimentalMemoryClass?: ExperimentalMemoryClass;
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
  capabilityClass: CapabilityClass;
  staticCapabilityProfile?: StaticCapabilityProfile;
  measuredPerformance?: MeasuredPerformanceSample;
}

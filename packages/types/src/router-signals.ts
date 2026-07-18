// v0.7.0-alpha "Adaptive Model Router v1" contracts. These types are additive:
// StaticCapabilityProfile and LocalBenchmarkResult are produced locally and
// consumed by the pure adaptive router core. They live in this zero-dependency
// leaf package (rather than device-profiler/local-benchmark/ai-runtime/
// model-router individually) so every future producer and consumer package
// can share one contract without any of them depending on each other,
// avoiding a circular dependency between router, runtime, and registry.

// Coarse, non-identifying capability categories, matching the bucketing
// already used by @free-ai-open/device-profiler's v0.6 DeviceProfile (which
// re-exports these two from here for backward compatibility).
import type { DeviceTier } from "./core";

export type FormFactor = "mobile" | "tablet" | "desktop" | "unknown";
export type ArchitectureClass = "arm" | "x86" | "unknown";
export type MemoryClass = "low" | "medium" | "high" | "unknown";
export type LogicalProcessorClass = "low" | "medium" | "high" | "unknown";
export type CapabilityClass = "compatibility" | "light" | "balanced" | "performance";
export type GpuVendorClass = "nvidia" | "amd" | "intel" | "apple" | "qualcomm" | "arm" | "unknown";
export type GpuArchitectureClass =
  | "apple"
  | "adreno"
  | "mali"
  | "nvidia-modern"
  | "nvidia-legacy"
  | "amd-rdna"
  | "amd-legacy"
  | "intel-xe"
  | "intel-legacy"
  | "unknown";
export type GpuDescriptionClass = "integrated" | "discrete" | "software" | "unknown";
export type GpuLimitClass = "low" | "medium" | "high" | "very_high" | "unknown";
export type ExperimentalMemoryClass = "lt_1gb" | "1_to_2gb" | "2_to_4gb" | "4_to_8gb" | "8gb_plus" | "unknown";

// How much a producer trusts its own signal. Used by capability profiles,
// benchmark results, and router decisions alike, so a caller can weigh a
// recommendation appropriately when inputs are partial or stale.
export type CapabilityConfidence = "low" | "medium" | "high";

// A device's static (non-benchmarked) capability signals. Raw GPU adapter
// strings and exact high-entropy limit maps may be read ephemerally by a
// detector to derive the coarse `gpu` classes below, but must never be
// persisted or included here themselves — see "Persistence boundaries" in
// docs/architecture.md and docs/privacy.md. Nothing in this shape is a raw
// sensor value or unique enough to fingerprint a device.
export interface StaticCapabilityProfile {
  schemaVersion: number;
  detectedAt: string;
  expiresAt: string;
  formFactor: FormFactor;
  architectureClass: ArchitectureClass;
  browserFamily: string;
  osFamily: string;
  memoryClass: MemoryClass;
  logicalProcessorClass: LogicalProcessorClass;
  approximateMemoryGB?: number;
  logicalProcessors?: number;
  webgpuAvailable: boolean;
  wasmAvailable: boolean;
  fallbackAdapter?: boolean;
  capabilityClass: CapabilityClass;
  deviceTier: DeviceTier;
  gpu: {
    vendorClass?: GpuVendorClass;
    architectureClass?: GpuArchitectureClass;
    descriptionClass?: GpuDescriptionClass;
    featureClasses: string[];
    limitClasses: Record<string, GpuLimitClass>;
    // Bonus-only signal: an experimental, browser-reported memory heap bucket.
    // Never required and never treated as an exact VRAM figure.
    experimentalMemoryClass?: ExperimentalMemoryClass;
    experimentalMemoryConfidence?: "low";
  };
  confidence: CapabilityConfidence;
}

export type LocalBenchmarkStatus = "completed" | "cancelled" | "failed" | "unsupported";
export type LocalBenchmarkStability = "unknown" | "stable" | "degraded" | "failed";
export type LocalBenchmarkResponsiveness = "unknown" | "responsive" | "degraded" | "poor";
export type LocalBenchmarkTimingMethod = "wall-clock" | "gpu-timestamp";
export type LocalBenchmarkStage = "initialization" | "warmup" | "compute" | "validation" | "complete";
export type LocalBenchmarkErrorCode =
  | "webgpu_unavailable"
  | "adapter_request_failed"
  | "device_request_failed"
  | "invalid_compute_result"
  | "out_of_memory"
  | "device_lost"
  | "timeout"
  | "cancelled"
  | "background_throttled"
  | "worker_failed"
  | "unknown";

// Result of a short, local, privacy-safe microbenchmark. It contains only
// bounded technical measurements and a coarse profile key. It is never a
// hardware identifier and must never be transmitted.
export interface LocalBenchmarkResult {
  schemaVersion: number;
  benchmarkVersion: string;
  capabilityProfileKey: string;
  measuredAt: string;
  expiresAt: string;
  status: LocalBenchmarkStatus;
  stage: LocalBenchmarkStage;
  webgpuInitMs?: number;
  computeScore?: number;
  medianComputeMs?: number;
  sampleCount?: number;
  mainThreadDelayMs?: number;
  durationMs?: number;
  timingMethod?: LocalBenchmarkTimingMethod;
  responsiveness: LocalBenchmarkResponsiveness;
  stability: LocalBenchmarkStability;
  confidence: CapabilityConfidence;
  errorCode?: LocalBenchmarkErrorCode;
}

// A single real, locally-observed model load/generation outcome. This is the
// contract @free-ai-open/ai-runtime will emit once it starts recording
// observed performance (not implemented yet); the router uses a history of
// these, alongside static capability and benchmark data, to let real
// measured behavior outweigh static assumptions over time. Never includes
// prompt or response content — only technical timings and an outcome code.
export interface ModelPerformanceObservation {
  schemaVersion: number;
  modelId: string;
  observedAt: string;
  loadSucceeded: boolean;
  loadTimeMs?: number;
  firstTokenTimeMs?: number;
  promptTokensPerSecond?: number;
  generationTokensPerSecond?: number;
  generationDurationMs?: number;
  testedContextTokens?: number;
  outcome:
    | "completed"
    | "cancelled"
    | "stalled"
    | "degenerate"
    | "out_of_memory"
    | "device_lost"
    | "load_failed";
}

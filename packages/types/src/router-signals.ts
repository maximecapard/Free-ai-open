// v0.7.0-alpha "Adaptive Model Router v1" contracts (Phase 0: contracts and
// architecture only). These types are additive and not yet wired to any
// detector, benchmark workload, or router implementation — see
// docs/roadmap.md for the phased rollout. They live in this zero-dependency
// leaf package (rather than device-profiler/local-benchmark/ai-runtime/
// model-router individually) so every future producer and consumer package
// can share one contract without any of them depending on each other,
// avoiding a circular dependency between router, runtime, and registry.

// Coarse, non-identifying capability categories, matching the bucketing
// already used by @free-ai-open/device-profiler's v0.6 DeviceProfile (which
// re-exports these two from here for backward compatibility).
export type FormFactor = "mobile" | "tablet" | "desktop" | "unknown";
export type ArchitectureClass = "arm" | "x86" | "unknown";

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
  formFactor: FormFactor;
  architectureClass: ArchitectureClass;
  browserFamily: string;
  osFamily: string;
  approximateMemoryGB?: number;
  logicalProcessors?: number;
  webgpuAvailable: boolean;
  wasmAvailable: boolean;
  fallbackAdapter?: boolean;
  gpu: {
    vendorClass?: string;
    architectureClass?: string;
    descriptionClass?: string;
    featureClasses: string[];
    limitClasses: Record<string, number | string>;
    // Bonus-only signal: an experimental, browser-reported memory heap size.
    // Never required and never treated as an exact VRAM figure.
    experimentalMemoryBytes?: number;
    experimentalMemoryConfidence?: "low";
  };
  confidence: CapabilityConfidence;
}

// Result of a short, local, privacy-safe microbenchmark. Never transmitted;
// `expiresAt` lets a caller treat a stale result as absent rather than
// re-running a benchmark on every visit. No benchmark workload exists yet —
// this is the contract a future @free-ai-open/local-benchmark package (or
// equivalent module) will produce.
export interface LocalBenchmarkResult {
  schemaVersion: number;
  benchmarkVersion: string;
  measuredAt: string;
  expiresAt: string;
  status: "completed" | "cancelled" | "failed" | "unsupported";
  webgpuInitMs?: number;
  computeScore?: number;
  mainThreadDelayMs?: number;
  stability: "unknown" | "stable" | "degraded" | "failed";
  confidence: CapabilityConfidence;
  errorCode?: string;
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

// v0.8.0-alpha "Local Benchmarks & Performance Intelligence" contracts
// (Phase 0: contracts/architecture only — no runner, no /benchmarks page
// yet, see docs/roadmap.md). A separate file from router-signals.ts on
// purpose: this is a distinct, later-versioned concern (a user-initiated,
// bounded MODEL benchmark run) that happens to share some vocabulary with
// the v0.7 adaptive-router contracts, not a replacement or extension of
// them. Kept in this zero-dependency leaf package for the same reason as
// router-signals.ts: a future runner package, the persistence package, the
// router, and the UI can all share this one contract without any of them
// depending on each other.
//
// This is NOT the existing generic device/WebGPU compute microbenchmark
// (LocalBenchmarkResult, in router-signals.ts) — that measures raw device
// throughput independent of any model. ModelBenchmarkResult measures one
// ACTUAL local model's real load/generation behavior on this device/
// browser: how long it took to load, how long until the first token, what
// generation speed was achieved, and whether the run was stable.
//
// Never persists benchmark prompt text, generated response content, exact
// GPU identifiers, or any unique fingerprinting identifier — only bounded
// technical measurements and coarse references. See docs/privacy.md's
// "Local model benchmarking" section.
import type { CapabilityConfidence, ModelPerformanceObservation } from "./router-signals";
import type { BrowserFamily } from "./capability-values";
import type { PerformanceMode } from "./core";

// A benchmark run's own scope/thoroughness — NOT the same axis as
// PerformanceMode (which describes how a user wants REAL chat generations
// to trade off speed vs. quality). "quick" is the only preset v0.8 actually
// ships a runner for; "standard"/"extended" are reserved here so the
// contract does not need to change again once they do — see
// docs/architecture.md's "Benchmark presets" section for why "quick" is
// the conservative first choice and what the other two are expected to
// widen (more samples/a longer generation, not a fundamentally different
// measurement).
export const modelBenchmarkPresets = ["quick", "standard", "extended"] as const;
export type ModelBenchmarkPreset = (typeof modelBenchmarkPresets)[number];

// Mirrors @free-ai-open/model-registry's own contextPresetIds ("compatibility"
// | "balanced" | "performance") exactly, by value, without importing that
// package (this one must stay dependency-free — see this file's own top
// comment). model-registry's own schema is the source of truth for what a
// real registry record's preset ids are; this is the parallel, structurally
// identical vocabulary a benchmark result references. Kept in sync
// deliberately — see benchmark-signals.test.ts.
export const modelBenchmarkContextPresets = ["compatibility", "balanced", "performance"] as const;
export type ModelBenchmarkContextPreset = (typeof modelBenchmarkContextPresets)[number];

// How far a benchmark run actually got before its terminal outcome — lets a
// caller distinguish "never loaded" from "loaded but stalled before any
// token" from "produced tokens then something went wrong", the same
// distinction LocalBenchmarkResult's own `stage` makes for the device
// microbenchmark.
export type ModelBenchmarkStage = "not_started" | "loading_model" | "awaiting_first_token" | "generating" | "complete";

// Deliberately the EXACT SAME union as ModelPerformanceObservation["outcome"]
// (see router-signals.ts) rather than a parallel-but-different one: a
// benchmark run and a real chat generation can end in exactly the same set
// of ways (a natural stop, hitting the output-token budget, a user
// cancelling, an unsupported response shape, an unexplained stream end, a
// genuine stall, out-of-memory, device loss, or a load failure), and
// reusing the identical type means any future change to that vocabulary
// (e.g. a new terminal case) is a single edit that keeps both in sync by
// construction, never two unions silently drifting apart. See
// docs/architecture.md's "Benchmark stability classification" section and
// classifyModelBenchmarkStability() in @free-ai-open/model-benchmark for
// the positive/neutral/negative grouping applied to this same union.
export type ModelBenchmarkOutcome = ModelPerformanceObservation["outcome"];

// Which exact model (registry entry + verified backend version) a result
// applies to — everything needed to detect "the registry or the verified
// WebLLM version has moved on since this ran" without persisting anything
// unique enough to fingerprint a device. `registryVersion` matches
// RouterInput/RouterDecision's own field of the same name (see
// packages/model-router/src/adaptiveRouterContracts.ts) so a caller can
// compare a benchmark result's provenance against a live router decision's
// using one identical string field.
export interface ModelBenchmarkModelReference {
  modelId: string;
  webllmModelId: string;
  registryVersion: string;
  quantization?: string;
  verifiedWithWebLLMVersion?: string;
}

// The controlled configuration a run was actually exercised against — a
// benchmark result is only meaningful alongside the exact preset/budget it
// was measured under, since the same model can behave very differently at
// a 1024-token vs. 4096-token context window.
export interface ModelBenchmarkRunConfig {
  contextPreset: ModelBenchmarkContextPreset;
  contextWindowTokens: number;
  requestedOutputTokens: number;
}

// Load time is measured from the model-load request to the runtime
// reporting "ready" — see docs/architecture.md's "Benchmark metric
// semantics" section for the exact boundary and why a first, uncached
// download is not split out into its own separately-measured phase (it
// cannot be measured consistently across browsers/CDN conditions, so this
// field is intentionally scoped as a single "everything the load step took"
// number rather than a false precision breakdown). `wasModelCachedBeforeRun`
// and `modelLoadedDuringRun` together let a reader tell apart three real
// cases: a fresh, uncached download+load; a cached-but-cold load (already
// downloaded, still had to initialize); and a model that was already
// loaded and ready before the benchmark started (in which case `loadTimeMs`
// is absent — there was nothing to time).
export interface ModelBenchmarkLoadMeasurement {
  wasModelCachedBeforeRun: boolean;
  modelLoadedDuringRun: boolean;
  loadTimeMs?: number;
}

// Time to first token is measured from inference start (the moment
// generation is requested, not the moment the model finished loading) to
// the EARLIEST raw token/chunk the runtime itself reports. Deliberately
// independent of React rendering or any buffered transcript update — see
// docs/architecture.md's "Streaming render responsiveness" section for the
// existing buffering layer this measurement must never be affected by.
export interface ModelBenchmarkFirstTokenMeasurement {
  firstTokenTimeMs?: number;
}

// "exact" only when a real runtime/tokenizer-backed generated-token count
// was available; "unavailable" otherwise. There is no third, approximate
// option: character-length-derived tok/s is explicitly disallowed as
// authoritative (see docs/architecture.md) — a caller with "unavailable"
// confidence must treat generationTokensPerSecond as absent, never fall
// back to estimating one from generatedCharacterCount/durationMs.
export type ModelBenchmarkTokenCountConfidence = "exact" | "unavailable";

// No real token count is available -- generationDurationMs alone (wall-
// clock time for the generation step) may still be known even when the
// runtime cannot report how many tokens that produced.
export interface ModelBenchmarkGenerationMeasurementUnavailable {
  tokenCountConfidence: "unavailable";
  generationDurationMs?: number;
}

// A real runtime/tokenizer-backed count was available. Deliberately a
// SEPARATE, all-fields-required shape (not "tokenCountConfidence: exact
// plus three independently-optional fields") so an "exact" measurement
// with a missing count, a missing duration, or no rate at all is not
// merely invalid data to be rejected later -- it is UNREPRESENTABLE by
// this type at all. @free-ai-open/model-benchmark's
// sanitizeModelBenchmarkResult() additionally enforces, at the value
// level (impossible to express as a TypeScript type constraint):
// generatedTokenCount is a non-negative INTEGER; generationDurationMs is
// strictly positive; generationTokensPerSecond is 0 when
// generatedTokenCount is 0, otherwise strictly positive AND numerically
// consistent with generatedTokenCount / (generationDurationMs / 1000)
// within a small explicit tolerance -- an authoritative "exact" rate can
// never merely be asserted, only actually be true.
export interface ModelBenchmarkGenerationMeasurementExact {
  tokenCountConfidence: "exact";
  generationDurationMs: number;
  generatedTokenCount: number;
  generationTokensPerSecond: number;
}

export type ModelBenchmarkGenerationMeasurement =
  | ModelBenchmarkGenerationMeasurementUnavailable
  | ModelBenchmarkGenerationMeasurementExact;

// The specific runtime/build context a result was produced under, beyond
// the registry-version fingerprint in ModelBenchmarkModelReference — the
// WebLLM library version in particular can change generation behavior
// (throughput, memory footprint) independent of the model or the registry
// entry describing it, so a benchmark result must be invalidated if this no
// longer matches what is actually running. appVersion is optional and
// app-supplied (matches the existing convention in
// @free-ai-open/diagnostic-report and @free-ai-open/telemetry, sourced from
// NEXT_PUBLIC_APP_VERSION at the app layer, never computed by this
// contract itself).
export interface ModelBenchmarkEnvironment {
  webllmVersion: string;
  appVersion?: string;
}

// One complete, versioned, local-only model benchmark run. Never includes
// the benchmark prompt, any generated text, exact GPU identifiers, or any
// unique fingerprinting identifier — only bounded technical measurements
// and coarse references (see this file's top comment and
// docs/privacy.md).
export interface ModelBenchmarkResult {
  schemaVersion: number;
  benchmarkVersion: string;
  id: string;
  // Duplicated from `model.modelId` at the top level so callers can index/
  // filter/join by model the same way every other contract in this
  // codebase does (ModelPerformanceObservation.modelId, RouterDecision's
  // selectedModelId, etc.) without reaching into a nested object first.
  modelId: string;
  model: ModelBenchmarkModelReference;
  createdAt: string;
  expiresAt: string;
  browserFamily: BrowserFamily;
  // The same coarse, non-identifying key LocalBenchmarkResult already uses
  // (see capability-values.ts's buildCapabilityProfileKey()) — never the
  // full StaticCapabilityProfile object.
  capabilityProfileKey: string;
  performanceMode: PerformanceMode;
  preset: ModelBenchmarkPreset;
  runConfig: ModelBenchmarkRunConfig;
  stage: ModelBenchmarkStage;
  outcome: ModelBenchmarkOutcome;
  load: ModelBenchmarkLoadMeasurement;
  firstToken: ModelBenchmarkFirstTokenMeasurement;
  generation: ModelBenchmarkGenerationMeasurement;
  // How much this specific result should be trusted (e.g. a single run vs.
  // one corroborated by several consistent samples in a future "standard"/
  // "extended" preset) — always optional, since a "quick" single-sample run
  // has no independent basis to claim a confidence level for itself.
  confidence?: CapabilityConfidence;
  environment: ModelBenchmarkEnvironment;
}

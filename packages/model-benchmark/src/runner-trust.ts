// Phase 2 correction pass: the runner's trust boundary. Everything about
// WHICH model is actually benchmarked and WHAT environment it is benchmarked
// against must come from an authoritative source the caller cannot override
// -- a structurally-valid-looking object is not the same thing as a verified
// one. This package deliberately does NOT implement these against a live
// @free-ai-open/model-registry/@free-ai-open/device-profiler/
// @free-ai-open/model-router lookup itself (that would require new
// dependency edges this package does not take on -- see runner.ts's own
// top-of-file comment and docs/architecture.md's "Phase 2" section). Instead
// it defines the CONTRACT a caller must satisfy, and the application/
// integration layer that actually constructs a runner (not built yet -- no
// `/benchmarks` page exists) is responsible for implementing these against
// its own real registry/capability-profiler/router-eligibility logic.
import type {
  BrowserFamily,
  ModelBenchmarkModelReference,
  PerformanceMode,
} from "@free-ai-open/types";

// Structurally identical to ModelBenchmarkModelReference: the authoritative,
// verified snapshot a TrustedBenchmarkTargetResolver returns for one model
// id. Never accepted as caller input on the runner's own public start()
// options -- see ModelBenchmarkRunOptions in runner.ts, which accepts only a
// bare `modelId` string precisely so a caller cannot supply/override
// `webllmModelId`/`registryVersion`/`quantization`/`verifiedWithWebLLMVersion`
// themselves.
export type TrustedBenchmarkTarget = ModelBenchmarkModelReference;

// Resolves a caller-supplied model id string to its authoritative registry
// record, or `null` if the id is not a real, currently-known model. A
// production implementation wraps @free-ai-open/model-registry's own lookup;
// this package only depends on the shape, never the registry package itself.
export interface TrustedBenchmarkTargetResolver {
  resolve(
    modelId: string,
  ): Promise<TrustedBenchmarkTarget | null> | TrustedBenchmarkTarget | null;
}

export function trustedBenchmarkTargetsEqual(
  a: TrustedBenchmarkTarget,
  b: TrustedBenchmarkTarget,
): boolean {
  return (
    a.modelId === b.modelId &&
    a.webllmModelId === b.webllmModelId &&
    a.registryVersion === b.registryVersion &&
    a.quantization === b.quantization &&
    a.verifiedWithWebLLMVersion === b.verifiedWithWebLLMVersion
  );
}

// The authoritative facts about the CURRENT environment a benchmark result
// is measured against. `benchmarkVersion` (an internal constant) and
// `webllmVersion` (ai-runtime's own INSTALLED_WEBLLM_VERSION) are NOT part
// of this snapshot -- the runner derives both itself, since it already knows
// them authoritatively and does not need this to supply them (see
// runner.ts's buildResult()). `registryVersion` is likewise not part of this
// snapshot: it travels with the resolved TrustedBenchmarkTarget instead,
// since it is a property of WHICH model was resolved, not of the ambient
// environment.
export interface TrustedBenchmarkEnvironmentSnapshot {
  browserFamily: BrowserFamily;
  capabilityProfileKey: string;
  performanceMode: PerformanceMode;
  appVersion?: string;
}

// A production implementation reads the app's own live capability-profiler
// output/browser detection/current performance-mode preference. Never
// caller-suppliable on the runner's public start() options -- a forged
// browserFamily/capabilityProfileKey could otherwise let a result claim to
// have been measured on a device/browser it never ran on.
export interface TrustedBenchmarkEnvironmentProvider {
  getSnapshot():
    | Promise<TrustedBenchmarkEnvironmentSnapshot>
    | TrustedBenchmarkEnvironmentSnapshot;
}

export interface BenchmarkEligibilityEligible {
  eligible: true;
}

export interface BenchmarkEligibilityIneligible {
  eligible: false;
  // A short, stable machine-readable reason (e.g. "webgpu_unavailable",
  // "form_factor_unsupported", "context_window_unsupported") -- deliberately
  // typed as a plain string rather than a shared enum with
  // @free-ai-open/model-router, since sharing that enum would require a new
  // dependency edge this package does not take on. A production adapter
  // that wraps the router's own hard-eligibility logic can pass its real
  // reason codes straight through.
  reasonCode: string;
  message: string;
}

export type BenchmarkEligibilityResult =
  BenchmarkEligibilityEligible | BenchmarkEligibilityIneligible;

// Hard eligibility ONLY -- eligible/ineligible plus a reason, never a
// router-style score. Evaluated BEFORE consent/cache/load, so an ineligible
// model never triggers a download or load attempt at all. A production
// implementation may wrap @free-ai-open/model-router's existing hard-gate
// logic (WebGPU availability, form factor, coarse capability class, context
// window support, etc.) without this package importing model-router itself.
export interface BenchmarkEligibilityEvaluator {
  evaluate(input: {
    target: TrustedBenchmarkTarget;
    environment: TrustedBenchmarkEnvironmentSnapshot;
  }): Promise<BenchmarkEligibilityResult> | BenchmarkEligibilityResult;
}

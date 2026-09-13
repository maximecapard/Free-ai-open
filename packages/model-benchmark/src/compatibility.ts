import type { BrowserFamily, ModelBenchmarkResult } from "@free-ai-open/types";
import { MODEL_BENCHMARK_VERSION } from "./constants";

export function isModelBenchmarkResultExpired(result: ModelBenchmarkResult, now: Date = new Date()): boolean {
  const expiresAt = Date.parse(result.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

// Everything a caller must currently match for a stored result to still be
// treated as real evidence about the CURRENT model/runtime/device -- never
// a partial or fuzzy match. Any mismatch means the environment that
// produced this result no longer exists in a comparable form, so the
// measurement itself is no longer trustworthy evidence (see
// docs/architecture.md's "Router relationship" section: stale or
// incompatible benchmark evidence must be ignored outright, never merely
// down-weighted).
export interface ModelBenchmarkCompatibilityContext {
  // The live @free-ai-open/model-registry version -- compared against
  // ModelBenchmarkResult.model.registryVersion. A registry update can
  // change a model's context presets, quantization, or verified status,
  // so a result measured against a prior registry entry is not
  // necessarily still accurate.
  registryVersion: string;
  // The WebLLM library version actually running -- compared against
  // ModelBenchmarkResult.environment.webllmVersion. WebLLM releases can
  // change generation throughput/memory behavior independent of the model
  // or registry entry describing it.
  webllmVersion: string;
  // The coarse device/browser capability key -- compared against
  // ModelBenchmarkResult.capabilityProfileKey (see
  // @free-ai-open/types' buildCapabilityProfileKey()). A result measured
  // on a materially different device/browser class is not evidence for
  // this one.
  capabilityProfileKey: string;
  // The current browser family -- compared against
  // ModelBenchmarkResult.browserFamily. Generation throughput and load
  // behavior can differ meaningfully across browser engines even on
  // otherwise-identical coarse capability signals, so a result measured on
  // a different browser family is not evidence for this one.
  browserFamily: BrowserFamily;
}

export function isModelBenchmarkResultCompatible(
  result: ModelBenchmarkResult,
  context: ModelBenchmarkCompatibilityContext
): boolean {
  return (
    // A result from an older or newer understanding of what a benchmark
    // run even measures is never usable evidence, regardless of anything
    // else matching -- this is a package-level constant, not something a
    // caller supplies, since it identifies THIS code's own contract
    // version rather than anything about the live environment.
    result.benchmarkVersion === MODEL_BENCHMARK_VERSION &&
    result.model.registryVersion === context.registryVersion &&
    result.environment.webllmVersion === context.webllmVersion &&
    result.capabilityProfileKey === context.capabilityProfileKey &&
    result.browserFamily === context.browserFamily
  );
}

// A result is usable evidence only when it is neither expired nor
// incompatible with the current environment -- the single predicate a
// future router/UI should call rather than re-deriving both checks
// separately and risking them drifting apart.
export function isModelBenchmarkResultUsable(
  result: ModelBenchmarkResult,
  context: ModelBenchmarkCompatibilityContext,
  now: Date = new Date()
): boolean {
  return !isModelBenchmarkResultExpired(result, now) && isModelBenchmarkResultCompatible(result, context);
}

export function filterUsableModelBenchmarkResults(
  results: readonly ModelBenchmarkResult[],
  context: ModelBenchmarkCompatibilityContext,
  now: Date = new Date()
): ModelBenchmarkResult[] {
  return results.filter((result) => isModelBenchmarkResultUsable(result, context, now));
}

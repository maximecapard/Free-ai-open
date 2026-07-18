import type { RuntimeErrorCode, GenerationStopReason } from "@free-ai-open/ai-runtime";
import type { ModelPerformanceObservation } from "@free-ai-open/types";

// v0.7.0-alpha Phase 4: turns a load or generation result from the persistent
// runtime into a technical-only ModelPerformanceObservation (never prompt or
// response content — see docs/privacy.md). schemaVersion here is
// informational only; modelObservationStore.recordModelPerformanceObservation
// stamps its own SCHEMA_VERSION on write.
const OBSERVATION_SCHEMA_VERSION = 1;

type ObservationOutcome = ModelPerformanceObservation["outcome"];

// Mirrors adaptiveEligibility.ts's RECENT_FATAL_FAILURE_LIMIT (2) and its
// repeated_oom/repeated_device_loss rejection reasons — not required to be
// bit-for-bit identical (the router applies the authoritative, windowed gate
// on every route call), just a cheap trigger for "a routing moment likely
// occurred" so the provider knows to ask the router again promptly instead of
// waiting for the next task/mode/locale change.
const FATAL_OUTCOMES = new Set<ObservationOutcome>(["out_of_memory", "device_lost"]);
const RECENT_FAILURE_THRESHOLD = 2;

export function isModelRepeatedlyFailing(observations: readonly ModelPerformanceObservation[], modelId: string): boolean {
  const fatalCount = observations.filter(
    (observation) => observation.modelId === modelId && FATAL_OUTCOMES.has(observation.outcome)
  ).length;
  return fatalCount >= RECENT_FAILURE_THRESHOLD;
}

export function classifyLoadOutcome(succeeded: boolean, errorCode?: RuntimeErrorCode): ObservationOutcome {
  if (succeeded) return "completed";
  // ai-runtime's classifier maps WebLLM's DeviceLostError to "out_of_memory"
  // (see packages/ai-runtime/src/errors.ts) — there is currently no distinct
  // RuntimeErrorCode for GPU device loss, so this builder never emits the
  // observation type's separate "device_lost" outcome from a load failure.
  // A future ai-runtime refinement could split that case out if it proves
  // useful for routing; documented as a known limitation.
  if (errorCode === "out_of_memory") return "out_of_memory";
  return "load_failed";
}

export function classifyGenerationOutcome(
  stopReason: GenerationStopReason | null,
  errorCode?: RuntimeErrorCode,
): ObservationOutcome {
  if (stopReason === "cancelled" || errorCode === "generation_interrupted" || errorCode === "cancel_timeout") {
    return "cancelled";
  }
  if (stopReason === "degenerate_output" || errorCode === "degenerate_output") {
    return "degenerate";
  }
  if (errorCode === "generation_stalled" || errorCode === "generation_timeout") {
    return "stalled";
  }
  if (errorCode === "out_of_memory") {
    return "out_of_memory";
  }
  if (stopReason === "completed" && !errorCode) {
    return "completed";
  }
  // Any other unclassified runtime error mid-generation (e.g. a GPU feature
  // or model error surfacing after load somehow) — treated conservatively as
  // a stall rather than invented as a new outcome bucket, since the
  // generation did not run to completion for a runtime reason.
  if (errorCode) return "stalled";
  return "completed";
}

export interface BuildLoadObservationInput {
  modelId: string;
  succeeded: boolean;
  loadTimeMs?: number;
  errorCode?: RuntimeErrorCode;
  now?: () => Date;
}

export function buildLoadObservation(input: BuildLoadObservationInput): ModelPerformanceObservation {
  const observedAt = (input.now ?? (() => new Date()))().toISOString();
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    modelId: input.modelId,
    observedAt,
    loadSucceeded: input.succeeded,
    loadTimeMs: input.loadTimeMs,
    outcome: classifyLoadOutcome(input.succeeded, input.errorCode),
  };
}

export interface BuildGenerationObservationInput {
  modelId: string;
  firstTokenTimeMs?: number;
  promptTokensPerSecond?: number;
  generationTokensPerSecond?: number;
  generationDurationMs?: number;
  testedContextTokens?: number;
  stopReason: GenerationStopReason | null;
  errorCode?: RuntimeErrorCode;
  now?: () => Date;
}

export function buildGenerationObservation(input: BuildGenerationObservationInput): ModelPerformanceObservation {
  const observedAt = (input.now ?? (() => new Date()))().toISOString();
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    modelId: input.modelId,
    observedAt,
    // Generation only ever runs after a successful load.
    loadSucceeded: true,
    firstTokenTimeMs: input.firstTokenTimeMs,
    promptTokensPerSecond: input.promptTokensPerSecond,
    generationTokensPerSecond: input.generationTokensPerSecond,
    generationDurationMs: input.generationDurationMs,
    testedContextTokens: input.testedContextTokens,
    outcome: classifyGenerationOutcome(input.stopReason, input.errorCode),
  };
}

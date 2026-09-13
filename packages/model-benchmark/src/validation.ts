import { browserFamilies, modelBenchmarkContextPresets, modelBenchmarkPresets } from "@free-ai-open/types";
import type {
  CapabilityClass,
  FormFactor,
  ModelBenchmarkContextPreset,
  ModelBenchmarkEnvironment,
  ModelBenchmarkFirstTokenMeasurement,
  ModelBenchmarkGenerationMeasurement,
  ModelBenchmarkLoadMeasurement,
  ModelBenchmarkModelReference,
  ModelBenchmarkOutcome,
  ModelBenchmarkPreset,
  ModelBenchmarkResult,
  ModelBenchmarkRunConfig,
  ModelBenchmarkStage,
} from "@free-ai-open/types";
import { MODEL_BENCHMARK_SCHEMA_VERSION, MODEL_BENCHMARK_VERSION } from "./constants";
import { calculateModelBenchmarkExpiry } from "./expiry";

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,159}$/;
const SEMVER_LIKE_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
// A generous upper bound, not a realistic expectation -- mirrors
// apps/web/app/_lib/modelObservationStore.ts's own MAX_TIMING_MS exactly,
// so a single corrupted value can never pass as a plausible measurement.
const MAX_TIMING_MS = 24 * 60 * 60 * 1_000;
const MAX_TOKEN_COUNT = 1_000_000;
const MAX_TOKEN_RATE = 100_000;
const MAX_CONTEXT_TOKENS = 10_000_000;

// A small explicit tolerance for comparing a claimed generationTokensPerSecond
// against generatedTokenCount / (generationDurationMs / 1000): a real runner
// computes and then rounds/truncates the rate for storage/display, so exact
// floating-point equality would reject legitimate values. 2% relative (with
// a 0.05 tok/s floor so a near-zero rate still has a meaningful tolerance)
// comfortably covers reasonable rounding while still rejecting a rate that
// is not actually derived from the count/duration it is stored alongside.
const RATE_CONSISTENCY_RELATIVE_TOLERANCE = 0.02;
const RATE_CONSISTENCY_ABSOLUTE_TOLERANCE = 0.05;

const VALID_STAGES = new Set<ModelBenchmarkStage>([
  "not_started",
  "loading_model",
  "awaiting_first_token",
  "generating",
  "complete",
]);
const VALID_OUTCOMES = new Set<ModelBenchmarkOutcome>([
  "completed",
  "cancelled",
  "stalled",
  "degenerate",
  "out_of_memory",
  "device_lost",
  "load_failed",
  "length_limited",
  "unsupported_tool_call",
  "terminal_unknown",
]);
const VALID_PRESETS = new Set<string>(modelBenchmarkPresets);
const VALID_CONTEXT_PRESETS = new Set<string>(modelBenchmarkContextPresets);
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);
const VALID_PERFORMANCE_MODES = new Set(["fast", "balanced", "performance"]);
const VALID_BROWSER_FAMILIES = new Set<string>(browserFamilies);

// The exact, low-entropy grammar apps/web (through
// @free-ai-open/types' buildCapabilityProfileKey()) produces:
// "{formFactor}:{capabilityClass}:{webgpu|no-webgpu}:{fallback|native}".
// Every segment is checked against its own small allowlist rather than
// accepting any bounded-length string -- a UUID, an exact GPU adapter
// description, or any other high-entropy value can never pass this check
// even if it happens to be under the old length cap. `browserFamily` is
// already its own separate field on ModelBenchmarkResult, so it is
// deliberately NOT one of these segments -- duplicating it here would only
// widen the key's entropy for no compatibility benefit. See
// docs/architecture.md's "Capability compatibility key" section.
// Typed as readonly string[] literals of FormFactor/CapabilityClass (rather
// than Set<FormFactor>) so `.has()` can be called with the plain `string`
// segments split() produces without an unsound cast -- the array literal
// itself still gets checked against the real union types below.
const FORM_FACTOR_VALUES: readonly FormFactor[] = ["mobile", "tablet", "desktop", "unknown"];
const CAPABILITY_CLASS_VALUES: readonly CapabilityClass[] = ["compatibility", "light", "balanced", "performance"];
const CAPABILITY_KEY_FORM_FACTORS = new Set<string>(FORM_FACTOR_VALUES);
const CAPABILITY_KEY_CAPABILITY_CLASSES = new Set<string>(CAPABILITY_CLASS_VALUES);
const CAPABILITY_KEY_WEBGPU_SEGMENTS = new Set(["webgpu", "no-webgpu"]);
const CAPABILITY_KEY_ADAPTER_SEGMENTS = new Set(["fallback", "native"]);

export function isValidCapabilityProfileKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const segments = value.split(":");
  if (segments.length !== 4) return false;
  const [formFactor, capabilityClass, webgpuSegment, adapterSegment] = segments;
  return (
    CAPABILITY_KEY_FORM_FACTORS.has(formFactor ?? "") &&
    CAPABILITY_KEY_CAPABILITY_CLASSES.has(capabilityClass ?? "") &&
    CAPABILITY_KEY_WEBGPU_SEGMENTS.has(webgpuSegment ?? "") &&
    CAPABILITY_KEY_ADAPTER_SEGMENTS.has(adapterSegment ?? "")
  );
}

// Which outcomes are legal for each stage a benchmark run could have
// reached -- the exhaustive invariant layer standing in for a full
// discriminated-union rewrite of ModelBenchmarkResult itself (a much
// larger, more invasive contract change this Phase 0 correction
// deliberately avoids -- see docs/architecture.md's "Benchmark stage/
// outcome legality" section for the full reasoning behind every row).
// Anything not listed here is an impossible combination and rejected
// outright by sanitizeModelBenchmarkResult().
const LEGAL_STAGE_OUTCOMES: Record<ModelBenchmarkStage, ReadonlySet<ModelBenchmarkOutcome>> = {
  // Never even attempted -- the only thing that can end a run before it
  // starts is a cancellation.
  not_started: new Set<ModelBenchmarkOutcome>(["cancelled"]),
  // Attempted a load, never reached generation.
  loading_model: new Set<ModelBenchmarkOutcome>(["load_failed", "cancelled", "out_of_memory", "device_lost"]),
  // Loaded successfully, generation was requested, no token has arrived yet.
  awaiting_first_token: new Set<ModelBenchmarkOutcome>(["stalled", "cancelled", "out_of_memory", "device_lost", "terminal_unknown"]),
  // At least one token was produced; the generate loop was interrupted
  // before it could reach its own terminal signal.
  generating: new Set<ModelBenchmarkOutcome>(["stalled", "cancelled", "degenerate", "out_of_memory", "device_lost"]),
  // The generate loop reached its own terminal signal, one way or another.
  complete: new Set<ModelBenchmarkOutcome>(["completed", "length_limited", "unsupported_tool_call", "terminal_unknown"]),
};

// Stages at which at least one token has actually been produced.
const STAGES_WITH_FIRST_TOKEN = new Set<ModelBenchmarkStage>(["generating", "complete"]);
// Stages at which any generation measurement could possibly exist.
const STAGES_WITH_GENERATION = new Set<ModelBenchmarkStage>(["generating", "complete"]);

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// Whether `rate` is numerically consistent with tokenCount tokens produced
// over durationMs milliseconds, within RATE_CONSISTENCY_*_TOLERANCE -- see
// this file's own top comment for why an exact floating-point match is not
// required.
function isRateConsistentWithCountAndDuration(rate: number, tokenCount: number, durationMs: number): boolean {
  const expected = tokenCount / (durationMs / 1000);
  const tolerance = Math.max(RATE_CONSISTENCY_ABSOLUTE_TOLERANCE, expected * RATE_CONSISTENCY_RELATIVE_TOLERANCE);
  return Math.abs(rate - expected) <= tolerance;
}

function sanitizeModelReference(value: unknown): ModelBenchmarkModelReference | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  if (typeof candidate.modelId !== "string" || !MODEL_ID_PATTERN.test(candidate.modelId)) return null;
  if (typeof candidate.webllmModelId !== "string" || candidate.webllmModelId.length === 0 || candidate.webllmModelId.length > 200) {
    return null;
  }
  if (typeof candidate.registryVersion !== "string" || candidate.registryVersion.length === 0 || candidate.registryVersion.length > 40) {
    return null;
  }

  const reference: ModelBenchmarkModelReference = {
    modelId: candidate.modelId,
    webllmModelId: candidate.webllmModelId,
    registryVersion: candidate.registryVersion,
  };
  if (typeof candidate.quantization === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(candidate.quantization)) {
    reference.quantization = candidate.quantization;
  }
  if (typeof candidate.verifiedWithWebLLMVersion === "string" && SEMVER_LIKE_PATTERN.test(candidate.verifiedWithWebLLMVersion)) {
    reference.verifiedWithWebLLMVersion = candidate.verifiedWithWebLLMVersion;
  }
  return reference;
}

function sanitizeRunConfig(value: unknown): ModelBenchmarkRunConfig | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  if (typeof candidate.contextPreset !== "string" || !VALID_CONTEXT_PRESETS.has(candidate.contextPreset)) return null;
  if (!isFiniteInRange(candidate.contextWindowTokens, 1, MAX_CONTEXT_TOKENS)) return null;
  if (!isFiniteInRange(candidate.requestedOutputTokens, 1, MAX_CONTEXT_TOKENS)) return null;

  return {
    contextPreset: candidate.contextPreset as ModelBenchmarkContextPreset,
    contextWindowTokens: candidate.contextWindowTokens,
    requestedOutputTokens: candidate.requestedOutputTokens,
  };
}

// True when `value` is present (not undefined) but fails the valid-range
// check -- the signal used throughout this file to REJECT THE WHOLE RESULT
// rather than silently drop just that field. A benchmark result is
// deliberate, infrequent, higher-stakes evidence (unlike, say,
// apps/web/app/_lib/modelObservationStore.ts's incidental per-generation
// observations, which do silently drop an individual bad metric) used to
// compare models and eventually inform routing -- a record containing an
// impossible value (a negative timing, a non-finite number) indicates the
// measurement pipeline itself is untrustworthy, which calls the ENTIRE
// result into question, not just the one malformed field. A genuinely
// ABSENT field (undefined) is always fine -- it just means that
// measurement was not available for this run.
function isPresentButInvalid(value: unknown, minimum: number, maximum: number): boolean {
  return value !== undefined && !isFiniteInRange(value, minimum, maximum);
}

function sanitizeLoad(value: unknown): ModelBenchmarkLoadMeasurement | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  if (typeof candidate.wasModelCachedBeforeRun !== "boolean") return null;
  if (typeof candidate.modelLoadedDuringRun !== "boolean") return null;
  if (isPresentButInvalid(candidate.loadTimeMs, 0, MAX_TIMING_MS)) return null;
  // A model that was NOT loaded during this run (it was already ready
  // beforehand) has nothing to time -- a loadTimeMs alongside
  // modelLoadedDuringRun: false would be claiming a measurement that
  // cannot have happened.
  if (!candidate.modelLoadedDuringRun && candidate.loadTimeMs !== undefined) return null;

  const load: ModelBenchmarkLoadMeasurement = {
    wasModelCachedBeforeRun: candidate.wasModelCachedBeforeRun,
    modelLoadedDuringRun: candidate.modelLoadedDuringRun,
  };
  if (isFiniteInRange(candidate.loadTimeMs, 0, MAX_TIMING_MS)) load.loadTimeMs = candidate.loadTimeMs;
  return load;
}

function sanitizeFirstToken(value: unknown): ModelBenchmarkFirstTokenMeasurement | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  if (isPresentButInvalid(candidate.firstTokenTimeMs, 0, MAX_TIMING_MS)) return null;

  const firstToken: ModelBenchmarkFirstTokenMeasurement = {};
  if (isFiniteInRange(candidate.firstTokenTimeMs, 0, MAX_TIMING_MS)) firstToken.firstTokenTimeMs = candidate.firstTokenTimeMs;
  return firstToken;
}

// Validates and reconstructs one ModelBenchmarkGenerationMeasurement,
// enforcing every invariant that makes an authoritative "exact" throughput
// figure trustworthy rather than merely asserted (see
// @free-ai-open/types' ModelBenchmarkGenerationMeasurementExact doc comment
// for the full list): generatedTokenCount must be a non-negative INTEGER;
// generationDurationMs must be present and strictly positive; when
// generatedTokenCount is 0, generationTokensPerSecond must be exactly 0
// (the only value consistent with the rate formula at zero tokens);
// otherwise generationTokensPerSecond must be strictly positive AND
// numerically consistent with generatedTokenCount / (generationDurationMs
// / 1000) within a small explicit tolerance. A character-length-derived or
// otherwise merely-plausible-looking rate that fails this consistency
// check is rejected exactly like any other impossible value.
function sanitizeGeneration(value: unknown): ModelBenchmarkGenerationMeasurement | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  if (candidate.tokenCountConfidence !== "exact" && candidate.tokenCountConfidence !== "unavailable") return null;
  if (isPresentButInvalid(candidate.generationDurationMs, 0, MAX_TIMING_MS)) return null;

  if (candidate.tokenCountConfidence === "unavailable") {
    // generatedTokenCount/generationTokensPerSecond are never meaningful
    // here and are dropped even if present in the raw input -- they are
    // not even expressible on this variant of the return type, matching
    // the contract's own "never a character-length-derived tok/s" rule.
    const generation: ModelBenchmarkGenerationMeasurement = { tokenCountConfidence: "unavailable" };
    if (isFiniteInRange(candidate.generationDurationMs, 0, MAX_TIMING_MS)) {
      generation.generationDurationMs = candidate.generationDurationMs;
    }
    return generation;
  }

  // tokenCountConfidence === "exact": every field the discriminated union
  // requires must be present and internally consistent.
  if (
    candidate.generationDurationMs === undefined ||
    !isFiniteInRange(candidate.generationDurationMs, 0, MAX_TIMING_MS) ||
    candidate.generationDurationMs <= 0
  ) {
    return null;
  }
  if (
    candidate.generatedTokenCount === undefined ||
    !isFiniteInRange(candidate.generatedTokenCount, 0, MAX_TOKEN_COUNT) ||
    !Number.isInteger(candidate.generatedTokenCount)
  ) {
    return null;
  }
  if (candidate.generationTokensPerSecond === undefined || !isFiniteInRange(candidate.generationTokensPerSecond, 0, MAX_TOKEN_RATE)) {
    return null;
  }

  const durationMs = candidate.generationDurationMs;
  const tokenCount = candidate.generatedTokenCount;
  const rate = candidate.generationTokensPerSecond;

  if (tokenCount === 0) {
    // The only value consistent with tokenCount / (durationMs / 1000) at
    // zero tokens.
    if (rate !== 0) return null;
  } else {
    if (rate <= 0) return null;
    if (!isRateConsistentWithCountAndDuration(rate, tokenCount, durationMs)) return null;
  }

  return {
    tokenCountConfidence: "exact",
    generationDurationMs: durationMs,
    generatedTokenCount: tokenCount,
    generationTokensPerSecond: rate,
  };
}

function sanitizeEnvironment(value: unknown): ModelBenchmarkEnvironment | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  if (typeof candidate.webllmVersion !== "string" || !SEMVER_LIKE_PATTERN.test(candidate.webllmVersion)) return null;

  const environment: ModelBenchmarkEnvironment = { webllmVersion: candidate.webllmVersion };
  if (typeof candidate.appVersion === "string" && candidate.appVersion.length > 0 && candidate.appVersion.length <= 40) {
    environment.appVersion = candidate.appVersion;
  }
  return environment;
}

// Defensively validates one persisted/deserialized ModelBenchmarkResult,
// returning null for anything malformed rather than throwing -- the same
// philosophy as @free-ai-open/conversation-store's normalizeMessage() and
// apps/web/app/_lib/modelObservationStore.ts's sanitizeObservation(): a
// single corrupted record must never take down an entire read, and a
// record from an unsupported (future or past) schemaVersion or
// benchmarkVersion is dropped rather than coerced into today's shape --
// see docs/architecture.md's "Benchmark persistence and migration"
// section. `now` defaults to the real clock and only needs to be supplied
// explicitly by a test that wants a deterministic "future createdAt"
// check.
export function sanitizeModelBenchmarkResult(value: unknown, now: Date = new Date()): ModelBenchmarkResult | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  if (candidate.schemaVersion !== MODEL_BENCHMARK_SCHEMA_VERSION) return null;
  // benchmarkVersion must match the CURRENT constant exactly -- an
  // arbitrary "reasonable-looking" string is not accepted, and neither is
  // an older or a future version: only this package's own current
  // understanding of what a benchmark run measures is ever valid evidence.
  if (candidate.benchmarkVersion !== MODEL_BENCHMARK_VERSION) return null;
  if (typeof candidate.id !== "string" || candidate.id.length === 0 || candidate.id.length > 200) return null;
  if (typeof candidate.modelId !== "string" || !MODEL_ID_PATTERN.test(candidate.modelId)) return null;
  if (!isIsoDateString(candidate.createdAt)) return null;
  if (Date.parse(candidate.createdAt) > now.getTime()) return null;
  if (!isIsoDateString(candidate.expiresAt)) return null;
  // expiresAt must equal the canonical formula EXACTLY -- never merely "not
  // later than" -- so a forged far-future expiry can never extend a
  // result's usable lifetime beyond the package's own TTL rule. See
  // expiry.ts's own doc comment.
  if (candidate.expiresAt !== calculateModelBenchmarkExpiry(candidate.createdAt)) return null;
  if (typeof candidate.browserFamily !== "string" || !VALID_BROWSER_FAMILIES.has(candidate.browserFamily)) return null;
  if (!isValidCapabilityProfileKey(candidate.capabilityProfileKey)) return null;
  if (typeof candidate.performanceMode !== "string" || !VALID_PERFORMANCE_MODES.has(candidate.performanceMode)) return null;
  if (typeof candidate.preset !== "string" || !VALID_PRESETS.has(candidate.preset)) return null;
  if (typeof candidate.stage !== "string" || !VALID_STAGES.has(candidate.stage as ModelBenchmarkStage)) return null;
  if (typeof candidate.outcome !== "string" || !VALID_OUTCOMES.has(candidate.outcome as ModelBenchmarkOutcome)) return null;

  const stage = candidate.stage as ModelBenchmarkStage;
  const outcome = candidate.outcome as ModelBenchmarkOutcome;
  if (!LEGAL_STAGE_OUTCOMES[stage].has(outcome)) return null;

  const model = sanitizeModelReference(candidate.model);
  if (!model) return null;
  // The top-level convenience field and the nested reference must agree --
  // see ModelBenchmarkResult's own doc comment on why modelId is
  // duplicated at the top level in the first place.
  if (model.modelId !== candidate.modelId) return null;

  const runConfig = sanitizeRunConfig(candidate.runConfig);
  if (!runConfig) return null;
  const load = sanitizeLoad(candidate.load);
  if (!load) return null;
  const firstToken = sanitizeFirstToken(candidate.firstToken);
  if (!firstToken) return null;
  const generation = sanitizeGeneration(candidate.generation);
  if (!generation) return null;
  const environment = sanitizeEnvironment(candidate.environment);
  if (!environment) return null;

  // Cross-field legality between stage and the measurements themselves --
  // see LEGAL_STAGE_OUTCOMES's own doc comment for why this lives here
  // rather than as a TypeScript discriminated union over the whole result.
  const reachedFirstToken = STAGES_WITH_FIRST_TOKEN.has(stage);
  if (reachedFirstToken !== (firstToken.firstTokenTimeMs !== undefined)) return null;

  const generationPossible = STAGES_WITH_GENERATION.has(stage);
  if (!generationPossible) {
    if (generation.tokenCountConfidence === "exact") return null;
    if (generation.generationDurationMs !== undefined) return null;
  }
  // A run that reached its own terminal signal (stage "complete") always
  // knows how long generation actually took -- wall-clock duration is
  // always computable once the loop has ended, even without an exact
  // token count.
  if (stage === "complete" && generation.generationDurationMs === undefined) return null;

  const result: ModelBenchmarkResult = {
    schemaVersion: MODEL_BENCHMARK_SCHEMA_VERSION,
    benchmarkVersion: candidate.benchmarkVersion,
    id: candidate.id,
    modelId: candidate.modelId,
    model,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    browserFamily: candidate.browserFamily as ModelBenchmarkResult["browserFamily"],
    capabilityProfileKey: candidate.capabilityProfileKey,
    performanceMode: candidate.performanceMode as ModelBenchmarkResult["performanceMode"],
    preset: candidate.preset as ModelBenchmarkPreset,
    runConfig,
    stage,
    outcome,
    load,
    firstToken,
    generation,
    environment,
  };
  if (typeof candidate.confidence === "string" && VALID_CONFIDENCE.has(candidate.confidence)) {
    result.confidence = candidate.confidence as ModelBenchmarkResult["confidence"];
  }
  return result;
}

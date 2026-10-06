import type { ModelBenchmarkOutcome, ModelBenchmarkResult } from "@free-ai-open/types";

export type ModelBenchmarkStabilityClass = "positive" | "neutral" | "negative";

// Mirrors packages/model-router/src/adaptiveObservations.ts's
// NEUTRAL_OUTCOMES set for the four outcomes that also apply to a real chat
// generation, in both membership and philosophy: a user-cancelled benchmark
// run must never penalize the model, and neither must one that merely
// exhausted its own output-token budget ("length_limited"), returned a
// response shape this app does not support ("unsupported_tool_call"), or
// ended without any explicit terminal signal at all ("terminal_unknown") —
// the model produced valid behavior the whole time; the run simply could
// not confirm success either way.
//
// `"benchmark_timeout"`/`"load_timeout"` are ADDITIONALLY neutral here, and
// have no equivalent in model-router's own set at all: they exist only on
// `ModelBenchmarkOutcome` (see that type's own doc comment in
// @free-ai-open/types), representing the benchmark RUNNER's own policy
// deadline firing before the model itself confirmed success or genuine
// instability. A model emitting healthy progress right up until the
// runner's own safety deadline is not evidence of model instability —
// counting it as negative would contaminate benchmark evidence with the
// runner's own conservatism rather than the model's actual behavior.
const NEUTRAL_OUTCOMES = new Set<ModelBenchmarkOutcome>([
  "cancelled",
  "length_limited",
  "unsupported_tool_call",
  "terminal_unknown",
  "benchmark_timeout",
  "load_timeout",
]);

const NEGATIVE_OUTCOMES = new Set<ModelBenchmarkOutcome>(["stalled", "degenerate", "out_of_memory", "device_lost", "load_failed"]);

// Deliberately NOT persisted on ModelBenchmarkResult itself (see that
// type's own doc comment in @free-ai-open/types): computing this fresh
// from `outcome` means a future change to the classification rules applies
// retroactively to every already-stored result, rather than requiring a
// migration of historical data every time the rules are refined.
//
// Fails closed for anything outside the three known groups (never reached
// for a value that actually satisfies the ModelBenchmarkOutcome type, but
// this function's argument may originate from deserialized storage a
// caller chose not to route through sanitizeModelBenchmarkResult() first) —
// an unrecognized outcome is never assumed benign.
export function classifyModelBenchmarkStability(outcome: ModelBenchmarkOutcome): ModelBenchmarkStabilityClass {
  if (outcome === "completed") return "positive";
  if (NEUTRAL_OUTCOMES.has(outcome)) return "neutral";
  if (NEGATIVE_OUTCOMES.has(outcome)) return "negative";
  return "negative";
}

// Result-level classification: the outcome alone is not always enough. A
// "completed" record whose EXACT generated-token count is zero claims a
// natural completion that produced nothing -- the runner never writes such a
// record (it maps an empty completion to neutral terminal_unknown, see
// runner.ts), but a stored/legacy/forged one must still never IMPROVE a
// model's record, so it is neutral here rather than positive. Never
// negative: an empty completion is an unconfirmed run, not instability.
export function classifyModelBenchmarkResultStability(
  result: Pick<ModelBenchmarkResult, "outcome" | "generation">,
): ModelBenchmarkStabilityClass {
  if (
    result.outcome === "completed" &&
    result.generation.tokenCountConfidence === "exact" &&
    result.generation.generatedTokenCount === 0
  ) {
    return "neutral";
  }
  return classifyModelBenchmarkStability(result.outcome);
}

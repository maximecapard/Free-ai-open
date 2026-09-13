import type { ModelBenchmarkOutcome } from "@free-ai-open/types";

export type ModelBenchmarkStabilityClass = "positive" | "neutral" | "negative";

// Deliberately mirrors packages/model-router/src/adaptiveObservations.ts's
// NEUTRAL_OUTCOMES set exactly, in both membership and philosophy: a
// user-cancelled benchmark run must never penalize the model, and neither
// must one that merely exhausted its own output-token budget
// ("length_limited"), returned a response shape this app does not support
// ("unsupported_tool_call"), or ended without any explicit terminal signal
// at all ("terminal_unknown") — the model produced valid behavior the
// whole time; the run simply could not confirm success either way.
const NEUTRAL_OUTCOMES = new Set<ModelBenchmarkOutcome>([
  "cancelled",
  "length_limited",
  "unsupported_tool_call",
  "terminal_unknown",
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

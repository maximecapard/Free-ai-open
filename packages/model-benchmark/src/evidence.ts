import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { classifyModelBenchmarkResultStability } from "./stability";

// Bounded evidence strength derived purely from HOW MANY INFORMATIVE samples
// exist for one model -- never from any router scoring weight, which a
// future Phase (not this Phase 0 correction) still owns entirely. A sample is
// informative only when it says something about the model: a positive
// (completed) or a genuinely negative (stalled, degenerate, out-of-memory,
// device-lost, load-failed) result. Neutral runs -- cancellations, benchmark/
// load policy timeouts, terminal_unknown, length/tool endings, and an empty
// "completed" with zero generated tokens -- are valid history but carry no
// model evidence, so no number of them can ever raise the level. The one rule
// this package commits to now: a single sample is always "weak", never
// anything stronger no matter how good it looked -- see
// docs/architecture.md's "Router relationship" section: "one run must never
// dominate long-term stability observations built from many real
// generations."
export type ModelBenchmarkEvidenceLevel = "none" | "weak" | "moderate" | "strong";

// Minimum compatibleSampleCount required to reach each level (inclusive).
// Deliberately conservative and reviewable as a standalone constant -- a
// future phase may tune these, but the SHAPE of "count-gated, never
// score-gated, and a lone sample can never be strong evidence" is the part
// this Phase 0 correction fixes in place now, ahead of any router wiring.
export const MODEL_BENCHMARK_EVIDENCE_THRESHOLDS = {
  weak: 1,
  moderate: 5,
  strong: 15,
} as const;

function evidenceLevelForInformativeSampleCount(sampleCount: number): ModelBenchmarkEvidenceLevel {
  if (sampleCount >= MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.strong) return "strong";
  if (sampleCount >= MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.moderate) return "moderate";
  if (sampleCount >= MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.weak) return "weak";
  return "none";
}

// A pure aggregate over one model's already-filtered results. Callers pass
// exactly the compatible, non-expired samples for ONE model (typically
// `filterUsableModelBenchmarkResults(...)` narrowed to a single modelId) --
// never a mixed-model list, since every field here is meaningless across
// models. This function does no filtering/compatibility/expiry/model-id
// logic of its own; compatibility.ts already owns that, and this stays a
// pure, side-effect-free reducer so a future router integration can call
// it directly without depending on any storage/browser API.
export interface BenchmarkEvidenceSummary {
  // Raw history metadata: how many compatible, non-expired results were
  // supplied. This counts EVERY result -- neutral and empty ones included --
  // and deliberately does NOT drive `evidenceLevel`.
  compatibleSampleCount: number;
  // How many of those results are informative about the model: positive plus
  // genuinely negative stability. This is the count `evidenceLevel` is gated
  // on, so neutral/no-output runs can never strengthen confidence.
  informativeSampleCount: number;
  mostRecentAt: string | null;
  medianLoadTimeMs: number | null;
  medianFirstTokenTimeMs: number | null;
  // Aggregated ONLY from samples whose tokenCountConfidence is "exact" --
  // an "unavailable"-confidence sample contributes nothing here, matching
  // the same "never treat a merely-plausible rate as authoritative" rule
  // validation.ts enforces per-record. This is the FULL wall-clock
  // completion-token rate (includes prefill/TTFT, NOT decode-only) -- see
  // ModelBenchmarkGenerationMeasurementExact.overallCompletionTokensPerSecond's
  // own doc comment in @free-ai-open/types.
  medianOverallCompletionTokensPerSecond: number | null;
  stableRunCount: number;
  neutralRunCount: number;
  negativeRunCount: number;
  evidenceLevel: ModelBenchmarkEvidenceLevel;
}

// Standard (lower-)median: the middle value for an odd-length list, the
// mean of the two middle values for an even-length one. Preferred over a
// mean because a single wildly slow/fast outlier run must not swing the
// aggregate the way it would swing an average.
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export function summarizeModelBenchmarkEvidence(results: readonly ModelBenchmarkResult[]): BenchmarkEvidenceSummary {
  let stableRunCount = 0;
  let neutralRunCount = 0;
  let negativeRunCount = 0;
  let mostRecentAt: string | null = null;
  const loadTimes: number[] = [];
  const firstTokenTimes: number[] = [];
  const generationRates: number[] = [];

  for (const result of results) {
    // classifyModelBenchmarkResultStability() already encodes "cancelled/
    // length_limited/unsupported_tool_call/terminal_unknown must never
    // count as failures" (and that an empty "completed" is never positive)
    // -- reused here rather than re-deriving the same grouping so the two
    // can never silently drift apart.
    const stability = classifyModelBenchmarkResultStability(result);
    if (stability === "positive") stableRunCount += 1;
    else if (stability === "neutral") neutralRunCount += 1;
    else negativeRunCount += 1;

    if (mostRecentAt === null || Date.parse(result.createdAt) > Date.parse(mostRecentAt)) {
      mostRecentAt = result.createdAt;
    }
    if (result.load.loadTimeMs !== undefined) loadTimes.push(result.load.loadTimeMs);
    if (result.firstToken.firstTokenTimeMs !== undefined) firstTokenTimes.push(result.firstToken.firstTokenTimeMs);
    // A zero-token measurement is not a throughput sample: a rate of exactly
    // 0 tok/s there means "nothing was generated", and folding it in would
    // drag the median down for reasons unrelated to speed.
    if (result.generation.tokenCountConfidence === "exact" && result.generation.generatedTokenCount > 0) {
      generationRates.push(result.generation.overallCompletionTokensPerSecond);
    }
  }

  return {
    compatibleSampleCount: results.length,
    informativeSampleCount: stableRunCount + negativeRunCount,
    mostRecentAt,
    medianLoadTimeMs: median(loadTimes),
    medianFirstTokenTimeMs: median(firstTokenTimes),
    medianOverallCompletionTokensPerSecond: median(generationRates),
    stableRunCount,
    neutralRunCount,
    negativeRunCount,
    evidenceLevel: evidenceLevelForInformativeSampleCount(stableRunCount + negativeRunCount),
  };
}

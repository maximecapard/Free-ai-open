import { describe, expect, it } from "vitest";
import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { MODEL_BENCHMARK_EVIDENCE_THRESHOLDS, summarizeModelBenchmarkEvidence } from "./evidence";

function buildResult(overrides: Partial<ModelBenchmarkResult> = {}): ModelBenchmarkResult {
  return {
    schemaVersion: 1,
    benchmarkVersion: "1.0.0",
    id: overrides.id ?? `benchmark-${Math.random().toString(36).slice(2)}`,
    modelId: "qwen3-4b-instruct-q4f16",
    model: {
      modelId: "qwen3-4b-instruct-q4f16",
      webllmModelId: "Qwen3-4B-Instruct-q4f16_1-MLC",
      registryVersion: "0.7.0-alpha.1",
    },
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: "2026-08-31T10:00:00.000Z",
    browserFamily: "chrome",
    capabilityProfileKey: "desktop:performance:webgpu:native",
    performanceMode: "performance",
    preset: "quick",
    runConfig: { contextPreset: "performance", contextWindowTokens: 4096, requestedOutputTokens: 512 },
    stage: "complete",
    outcome: "completed",
    load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: true, loadTimeMs: 1000 },
    firstToken: { firstTokenTimeMs: 300 },
    generation: {
      tokenCountConfidence: "exact",
      generationDurationMs: 4000,
      generatedTokenCount: 200,
      overallCompletionTokensPerSecond: 50,
    },
    environment: { webllmVersion: "0.2.84" },
    ...overrides,
  };
}

describe("summarizeModelBenchmarkEvidence -- evidence level (count-gated, never score-gated)", () => {
  it("is 'none' for an empty sample set", () => {
    const summary = summarizeModelBenchmarkEvidence([]);
    expect(summary.evidenceLevel).toBe("none");
    expect(summary.compatibleSampleCount).toBe(0);
    expect(summary.informativeSampleCount).toBe(0);
    expect(summary.mostRecentAt).toBeNull();
    expect(summary.medianLoadTimeMs).toBeNull();
    expect(summary.medianFirstTokenTimeMs).toBeNull();
    expect(summary.medianOverallCompletionTokensPerSecond).toBeNull();
  });

  it("a single run is always 'weak' -- one result must never become strong evidence, no matter how good it looked", () => {
    const summary = summarizeModelBenchmarkEvidence([buildResult()]);
    expect(summary.evidenceLevel).toBe("weak");
    expect(summary.compatibleSampleCount).toBe(1);
  });

  it("stays 'weak' right up to (but not including) the moderate threshold", () => {
    const results = Array.from({ length: MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.moderate - 1 }, (_, index) =>
      buildResult({ id: `run-${index}` })
    );
    expect(summarizeModelBenchmarkEvidence(results).evidenceLevel).toBe("weak");
  });

  it("becomes 'moderate' exactly at the moderate threshold", () => {
    const results = Array.from({ length: MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.moderate }, (_, index) =>
      buildResult({ id: `run-${index}` })
    );
    expect(summarizeModelBenchmarkEvidence(results).evidenceLevel).toBe("moderate");
  });

  it("stays 'moderate' right up to (but not including) the strong threshold", () => {
    const results = Array.from({ length: MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.strong - 1 }, (_, index) =>
      buildResult({ id: `run-${index}` })
    );
    expect(summarizeModelBenchmarkEvidence(results).evidenceLevel).toBe("moderate");
  });

  it("becomes 'strong' exactly at the strong threshold", () => {
    const results = Array.from({ length: MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.strong }, (_, index) =>
      buildResult({ id: `run-${index}` })
    );
    expect(summarizeModelBenchmarkEvidence(results).evidenceLevel).toBe("strong");
  });
});

describe("summarizeModelBenchmarkEvidence -- stability tallies", () => {
  it("counts a neutral outcome (e.g. a user cancellation) separately, never inflating negativeRunCount", () => {
    const results = [
      buildResult({ id: "a", outcome: "completed" }),
      buildResult({ id: "b", outcome: "cancelled", stage: "generating", firstToken: { firstTokenTimeMs: 100 }, generation: { tokenCountConfidence: "unavailable" } }),
      buildResult({ id: "c", outcome: "stalled", stage: "generating", firstToken: { firstTokenTimeMs: 100 }, generation: { tokenCountConfidence: "unavailable" } }),
    ];
    const summary = summarizeModelBenchmarkEvidence(results);
    expect(summary.stableRunCount).toBe(1);
    expect(summary.neutralRunCount).toBe(1);
    expect(summary.negativeRunCount).toBe(1);
  });
});

describe("summarizeModelBenchmarkEvidence -- evidence strength counts INFORMATIVE samples only", () => {
  const zeroTokens: ModelBenchmarkResult["generation"] = {
    tokenCountConfidence: "exact",
    generationDurationMs: 1000,
    generatedTokenCount: 0,
    overallCompletionTokensPerSecond: 0,
  };
  const neutralStalledShape = {
    stage: "generating" as const,
    firstToken: { firstTokenTimeMs: 100 },
    generation: { tokenCountConfidence: "unavailable" as const },
  };
  const zeroTokenNeutral = (index: number) => buildResult({ id: `zero-${index}`, generation: zeroTokens });
  const informative = (index: number) => buildResult({ id: `informative-${index}` });

  it("one zero-token run is neutral history: it is counted as compatible but is NOT informative, so the level stays 'none'", () => {
    const summary = summarizeModelBenchmarkEvidence([zeroTokenNeutral(0)]);
    expect(summary.compatibleSampleCount).toBe(1);
    expect(summary.informativeSampleCount).toBe(0);
    expect(summary.evidenceLevel).toBe("none");
  });

  it("15 zero-token neutral runs STILL do not strengthen evidence (the old raw-count gate would have reported 'strong')", () => {
    const results = Array.from({ length: MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.strong }, (_, index) => zeroTokenNeutral(index));
    const summary = summarizeModelBenchmarkEvidence(results);
    expect(summary.compatibleSampleCount).toBe(MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.strong);
    expect(summary.informativeSampleCount).toBe(0);
    expect(summary.evidenceLevel).toBe("none");
  });

  it("every explicit neutral outcome is excluded from the informative count", () => {
    const neutralOutcomes = ["terminal_unknown", "benchmark_timeout", "cancelled", "length_limited", "unsupported_tool_call"] as const;
    const results = neutralOutcomes.flatMap((outcome) =>
      Array.from({ length: 5 }, (_, index) => buildResult({ id: `${outcome}-${index}`, outcome, ...neutralStalledShape }))
    );
    results.push(
      ...Array.from({ length: 5 }, (_, index) =>
        buildResult({
          id: `load-timeout-${index}`,
          outcome: "load_timeout",
          stage: "loading_model",
          firstToken: {},
          generation: { tokenCountConfidence: "unavailable" },
        })
      )
    );
    const summary = summarizeModelBenchmarkEvidence(results);
    expect(summary.compatibleSampleCount).toBe(30);
    expect(summary.neutralRunCount).toBe(30);
    expect(summary.informativeSampleCount).toBe(0);
    expect(summary.evidenceLevel).toBe("none");
  });

  it("genuine NEGATIVE model evidence is informative and does count (a stalled model is evidence)", () => {
    const results = Array.from({ length: MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.moderate }, (_, index) =>
      buildResult({ id: `stalled-${index}`, outcome: "stalled", ...neutralStalledShape })
    );
    const summary = summarizeModelBenchmarkEvidence(results);
    expect(summary.negativeRunCount).toBe(MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.moderate);
    expect(summary.informativeSampleCount).toBe(MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.moderate);
    expect(summary.evidenceLevel).toBe("moderate");
  });

  it("4 informative runs stay 'weak', 5 become 'moderate', 15 become 'strong' -- the existing thresholds, now on informative count", () => {
    const level = (count: number) =>
      summarizeModelBenchmarkEvidence(Array.from({ length: count }, (_, index) => informative(index))).evidenceLevel;
    expect(level(MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.moderate - 1)).toBe("weak");
    expect(level(MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.moderate)).toBe("moderate");
    expect(level(MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.strong - 1)).toBe("moderate");
    expect(level(MODEL_BENCHMARK_EVIDENCE_THRESHOLDS.strong)).toBe("strong");
  });

  it("mixed neutral + informative: the level depends ONLY on the informative count", () => {
    const manyNeutral = Array.from({ length: 40 }, (_, index) => zeroTokenNeutral(index));
    const fourInformative = Array.from({ length: 4 }, (_, index) => informative(index));
    const fiveInformative = Array.from({ length: 5 }, (_, index) => informative(index));
    const fifteenInformative = Array.from({ length: 15 }, (_, index) => informative(index));

    const weak = summarizeModelBenchmarkEvidence([...manyNeutral, ...fourInformative]);
    expect(weak.compatibleSampleCount).toBe(44);
    expect(weak.informativeSampleCount).toBe(4);
    expect(weak.evidenceLevel).toBe("weak");
    expect(summarizeModelBenchmarkEvidence([...manyNeutral, ...fiveInformative]).evidenceLevel).toBe("moderate");
    expect(summarizeModelBenchmarkEvidence([...manyNeutral, ...fifteenInformative]).evidenceLevel).toBe("strong");
  });
});

describe("summarizeModelBenchmarkEvidence -- an empty completion never improves the record", () => {
  const zeroTokens: ModelBenchmarkResult["generation"] = {
    tokenCountConfidence: "exact",
    generationDurationMs: 1000,
    generatedTokenCount: 0,
    overallCompletionTokensPerSecond: 0,
  };

  it("counts a 'completed' record with zero exact tokens as neutral, never stable", () => {
    const summary = summarizeModelBenchmarkEvidence([buildResult({ generation: zeroTokens })]);
    expect(summary.stableRunCount).toBe(0);
    expect(summary.neutralRunCount).toBe(1);
    expect(summary.negativeRunCount).toBe(0);
  });

  it("excludes a zero-token measurement from the throughput median instead of averaging in a meaningless 0 tok/s", () => {
    const summary = summarizeModelBenchmarkEvidence([
      buildResult({ generation: zeroTokens }),
      buildResult({
        generation: { tokenCountConfidence: "exact", generationDurationMs: 4000, generatedTokenCount: 200, overallCompletionTokensPerSecond: 50 },
      }),
    ]);
    expect(summary.medianOverallCompletionTokensPerSecond).toBe(50);
  });
});

describe("summarizeModelBenchmarkEvidence -- most recent timestamp", () => {
  it("picks the maximum createdAt regardless of input array order", () => {
    const results = [
      buildResult({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
      buildResult({ id: "newest", createdAt: "2026-06-01T00:00:00.000Z" }),
      buildResult({ id: "middle", createdAt: "2026-03-01T00:00:00.000Z" }),
    ];
    expect(summarizeModelBenchmarkEvidence(results).mostRecentAt).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("summarizeModelBenchmarkEvidence -- median aggregation", () => {
  it("computes the median load time across an odd number of samples", () => {
    const results = [1000, 2000, 3000].map((loadTimeMs, index) =>
      buildResult({ id: `run-${index}`, load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: true, loadTimeMs } })
    );
    expect(summarizeModelBenchmarkEvidence(results).medianLoadTimeMs).toBe(2000);
  });

  it("computes the median load time across an even number of samples as the mean of the two middle values", () => {
    const results = [1000, 2000, 3000, 4000].map((loadTimeMs, index) =>
      buildResult({ id: `run-${index}`, load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: true, loadTimeMs } })
    );
    expect(summarizeModelBenchmarkEvidence(results).medianLoadTimeMs).toBe(2500);
  });

  it("excludes samples with no loadTimeMs (a reused, already-loaded model) from the load time median rather than treating them as zero", () => {
    const results = [
      buildResult({ id: "reused", load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: false } }),
      buildResult({ id: "loaded", load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: true, loadTimeMs: 5000 } }),
    ];
    expect(summarizeModelBenchmarkEvidence(results).medianLoadTimeMs).toBe(5000);
  });

  it("aggregates medianOverallCompletionTokensPerSecond only from exact-confidence samples, ignoring unavailable ones", () => {
    const results = [
      buildResult({ id: "exact-1", generation: { tokenCountConfidence: "exact", generationDurationMs: 1000, generatedTokenCount: 40, overallCompletionTokensPerSecond: 40 } }),
      buildResult({ id: "exact-2", generation: { tokenCountConfidence: "exact", generationDurationMs: 1000, generatedTokenCount: 60, overallCompletionTokensPerSecond: 60 } }),
      buildResult({ id: "unavailable", generation: { tokenCountConfidence: "unavailable", generationDurationMs: 1000 } }),
    ];
    expect(summarizeModelBenchmarkEvidence(results).medianOverallCompletionTokensPerSecond).toBe(50);
  });

  it("returns null medians when no sample in the set carries that measurement", () => {
    const results = [
      buildResult({
        id: "no-measurements",
        load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: false },
        firstToken: {},
        generation: { tokenCountConfidence: "unavailable" },
      }),
    ];
    const summary = summarizeModelBenchmarkEvidence(results);
    expect(summary.medianLoadTimeMs).toBeNull();
    expect(summary.medianFirstTokenTimeMs).toBeNull();
    expect(summary.medianOverallCompletionTokensPerSecond).toBeNull();
  });
});

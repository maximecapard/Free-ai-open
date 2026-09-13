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
      generationTokensPerSecond: 50,
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
    expect(summary.mostRecentAt).toBeNull();
    expect(summary.medianLoadTimeMs).toBeNull();
    expect(summary.medianFirstTokenTimeMs).toBeNull();
    expect(summary.medianGenerationTokensPerSecond).toBeNull();
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

  it("aggregates medianGenerationTokensPerSecond only from exact-confidence samples, ignoring unavailable ones", () => {
    const results = [
      buildResult({ id: "exact-1", generation: { tokenCountConfidence: "exact", generationDurationMs: 1000, generatedTokenCount: 40, generationTokensPerSecond: 40 } }),
      buildResult({ id: "exact-2", generation: { tokenCountConfidence: "exact", generationDurationMs: 1000, generatedTokenCount: 60, generationTokensPerSecond: 60 } }),
      buildResult({ id: "unavailable", generation: { tokenCountConfidence: "unavailable", generationDurationMs: 1000 } }),
    ];
    expect(summarizeModelBenchmarkEvidence(results).medianGenerationTokensPerSecond).toBe(50);
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
    expect(summary.medianGenerationTokensPerSecond).toBeNull();
  });
});

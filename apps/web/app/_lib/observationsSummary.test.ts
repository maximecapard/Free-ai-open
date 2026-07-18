import { describe, expect, it } from "vitest";
import type { ModelPerformanceObservation } from "@free-ai-open/types";
import { summarizeStoredObservations } from "./observationsSummary";

function observation(modelId: string, outcome: ModelPerformanceObservation["outcome"]): ModelPerformanceObservation {
  return { schemaVersion: 1, modelId, observedAt: "2026-07-18T00:00:00.000Z", loadSucceeded: outcome === "completed", outcome };
}

describe("summarizeStoredObservations", () => {
  it("returns all-zero counts for an empty list", () => {
    expect(summarizeStoredObservations([])).toEqual({
      total: 0,
      byOutcome: {
        completed: 0,
        cancelled: 0,
        stalled: 0,
        degenerate: 0,
        out_of_memory: 0,
        device_lost: 0,
        load_failed: 0,
      },
      byModel: {},
    });
  });

  it("tallies outcomes and per-model counts across mixed observations", () => {
    const summary = summarizeStoredObservations([
      observation("qwen3-1.7b-q4f16", "completed"),
      observation("qwen3-1.7b-q4f16", "completed"),
      observation("qwen3-1.7b-q4f16", "cancelled"),
      observation("smollm2-360m-instruct-q4f32", "out_of_memory"),
    ]);

    expect(summary.total).toBe(4);
    expect(summary.byOutcome.completed).toBe(2);
    expect(summary.byOutcome.cancelled).toBe(1);
    expect(summary.byOutcome.out_of_memory).toBe(1);
    expect(summary.byOutcome.stalled).toBe(0);
    expect(summary.byModel).toEqual({
      "qwen3-1.7b-q4f16": 3,
      "smollm2-360m-instruct-q4f32": 1,
    });
  });
});

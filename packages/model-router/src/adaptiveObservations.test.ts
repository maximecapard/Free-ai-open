import { describe, expect, it } from "vitest";
import type { ModelPerformanceObservation } from "@free-ai-open/types";
import { summarizeObservations } from "./adaptiveObservations";

function observation(overrides: Partial<ModelPerformanceObservation>): ModelPerformanceObservation {
  return {
    schemaVersion: 1,
    modelId: "qwen3-0.6b-q4f16",
    observedAt: "2026-07-18T11:00:00.000Z",
    loadSucceeded: true,
    outcome: "completed",
    ...overrides,
  };
}

describe("summarizeObservations", () => {
  it("keeps model loads separate from completed generations", () => {
    const summary = summarizeObservations([
      observation({ loadTimeMs: 1_200 }),
      observation({ generationDurationMs: 2_000, generationTokensPerSecond: 18 }),
    ]);

    expect(summary).toMatchObject({
      count: 2,
      loadAttempts: 1,
      successfulLoads: 1,
      generationCount: 1,
      completed: 1,
    });
  });

  it("does not count a generation observation as another successful load", () => {
    const summary = summarizeObservations([
      observation({ loadTimeMs: 1_200, loadSucceeded: false, outcome: "load_failed" }),
      observation({ generationDurationMs: 2_000 }),
    ]);

    expect(summary.loadAttempts).toBe(1);
    expect(summary.successfulLoads).toBe(0);
  });

  it("excludes cancellations from generation success rates", () => {
    const summary = summarizeObservations([
      observation({ outcome: "cancelled", loadSucceeded: true }),
      observation({ generationDurationMs: 2_000 }),
    ]);

    expect(summary.generationCount).toBe(1);
    expect(summary.completed).toBe(1);
  });
});

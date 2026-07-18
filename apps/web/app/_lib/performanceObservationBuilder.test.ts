import { describe, expect, it } from "vitest";
import type { ModelPerformanceObservation } from "@free-ai-open/types";
import {
  buildGenerationObservation,
  buildLoadObservation,
  classifyGenerationOutcome,
  classifyLoadOutcome,
  isModelRepeatedlyFailing,
} from "./performanceObservationBuilder";

const FIXED_NOW = () => new Date("2026-07-18T12:00:00.000Z");

function observation(modelId: string, outcome: ModelPerformanceObservation["outcome"]): ModelPerformanceObservation {
  return { schemaVersion: 1, modelId, observedAt: "2026-07-18T00:00:00.000Z", loadSucceeded: outcome === "completed", outcome };
}

describe("classifyLoadOutcome", () => {
  it("classifies a successful load as completed", () => {
    expect(classifyLoadOutcome(true)).toBe("completed");
  });

  it("classifies an out-of-memory load failure distinctly", () => {
    expect(classifyLoadOutcome(false, "out_of_memory")).toBe("out_of_memory");
  });

  it("classifies any other load failure as a generic load failure", () => {
    expect(classifyLoadOutcome(false, "model_unsupported")).toBe("load_failed");
    expect(classifyLoadOutcome(false, "webgpu_unavailable")).toBe("load_failed");
    expect(classifyLoadOutcome(false, undefined)).toBe("load_failed");
  });
});

describe("classifyGenerationOutcome", () => {
  it("classifies a clean completion", () => {
    expect(classifyGenerationOutcome("completed")).toBe("completed");
  });

  it("classifies user cancellation as cancelled, not a model failure", () => {
    expect(classifyGenerationOutcome("cancelled")).toBe("cancelled");
    expect(classifyGenerationOutcome(null, "generation_interrupted")).toBe("cancelled");
    expect(classifyGenerationOutcome(null, "cancel_timeout")).toBe("cancelled");
  });

  it("classifies degenerate output", () => {
    expect(classifyGenerationOutcome("degenerate_output")).toBe("degenerate");
    expect(classifyGenerationOutcome(null, "degenerate_output")).toBe("degenerate");
  });

  it("classifies stalls and timeouts as stalled", () => {
    expect(classifyGenerationOutcome(null, "generation_stalled")).toBe("stalled");
    expect(classifyGenerationOutcome(null, "generation_timeout")).toBe("stalled");
  });

  it("classifies out-of-memory distinctly", () => {
    expect(classifyGenerationOutcome(null, "out_of_memory")).toBe("out_of_memory");
  });

  it("falls back to stalled for an unclassified runtime error rather than inventing a new outcome", () => {
    expect(classifyGenerationOutcome(null, "unknown")).toBe("stalled");
  });
});

describe("buildLoadObservation", () => {
  it("builds a technical-only observation with no prompt or response content", () => {
    const observation = buildLoadObservation({
      modelId: "qwen3-1.7b-q4f16",
      succeeded: true,
      loadTimeMs: 4200,
      now: FIXED_NOW,
    });
    expect(observation).toEqual({
      schemaVersion: 1,
      modelId: "qwen3-1.7b-q4f16",
      observedAt: "2026-07-18T12:00:00.000Z",
      loadSucceeded: true,
      loadTimeMs: 4200,
      outcome: "completed",
    });
  });

  it("records the failure outcome for a failed load", () => {
    const observation = buildLoadObservation({
      modelId: "qwen3-4b-q4f16",
      succeeded: false,
      errorCode: "out_of_memory",
      now: FIXED_NOW,
    });
    expect(observation.loadSucceeded).toBe(false);
    expect(observation.outcome).toBe("out_of_memory");
  });
});

describe("buildGenerationObservation", () => {
  it("builds a technical-only observation for a successful generation", () => {
    const observation = buildGenerationObservation({
      modelId: "qwen3-1.7b-q4f16",
      firstTokenTimeMs: 320,
      promptTokensPerSecond: 85,
      generationTokensPerSecond: 22,
      generationDurationMs: 5100,
      testedContextTokens: 2048,
      stopReason: "completed",
      now: FIXED_NOW,
    });
    expect(observation).toEqual({
      schemaVersion: 1,
      modelId: "qwen3-1.7b-q4f16",
      observedAt: "2026-07-18T12:00:00.000Z",
      loadSucceeded: true,
      firstTokenTimeMs: 320,
      promptTokensPerSecond: 85,
      generationTokensPerSecond: 22,
      generationDurationMs: 5100,
      testedContextTokens: 2048,
      outcome: "completed",
    });
  });

  it("records a cancelled generation without treating it as a model failure", () => {
    const observation = buildGenerationObservation({
      modelId: "qwen3-1.7b-q4f16",
      stopReason: "cancelled",
      now: FIXED_NOW,
    });
    expect(observation.outcome).toBe("cancelled");
  });
});

describe("isModelRepeatedlyFailing", () => {
  it("is false with fewer than two fatal observations for the model", () => {
    const observations = [observation("qwen3-4b-q4f16", "out_of_memory")];
    expect(isModelRepeatedlyFailing(observations, "qwen3-4b-q4f16")).toBe(false);
  });

  it("is true once two or more out-of-memory observations accumulate for the model", () => {
    const observations = [
      observation("qwen3-4b-q4f16", "out_of_memory"),
      observation("qwen3-4b-q4f16", "out_of_memory"),
    ];
    expect(isModelRepeatedlyFailing(observations, "qwen3-4b-q4f16")).toBe(true);
  });

  it("does not count cancellations, stalls, or successes toward the fatal threshold", () => {
    const observations = [
      observation("qwen3-4b-q4f16", "cancelled"),
      observation("qwen3-4b-q4f16", "stalled"),
      observation("qwen3-4b-q4f16", "completed"),
      observation("qwen3-4b-q4f16", "out_of_memory"),
    ];
    expect(isModelRepeatedlyFailing(observations, "qwen3-4b-q4f16")).toBe(false);
  });

  it("ignores fatal observations that belong to a different model", () => {
    const observations = [
      observation("qwen3-4b-q4f16", "out_of_memory"),
      observation("qwen3-1.7b-q4f16", "out_of_memory"),
    ];
    expect(isModelRepeatedlyFailing(observations, "qwen3-4b-q4f16")).toBe(false);
  });
});

const TECHNICAL_FIELD_ALLOWLIST = new Set([
  "schemaVersion",
  "modelId",
  "observedAt",
  "loadSucceeded",
  "loadTimeMs",
  "firstTokenTimeMs",
  "promptTokensPerSecond",
  "generationTokensPerSecond",
  "generationDurationMs",
  "testedContextTokens",
  "outcome",
]);

describe("observation privacy shape", () => {
  it("buildLoadObservation only ever produces known technical fields", () => {
    const observation = buildLoadObservation({ modelId: "qwen3-1.7b-q4f16", succeeded: true, loadTimeMs: 1200, now: FIXED_NOW });
    for (const key of Object.keys(observation)) {
      expect(TECHNICAL_FIELD_ALLOWLIST.has(key)).toBe(true);
    }
  });

  it("buildGenerationObservation only ever produces known technical fields", () => {
    const observation = buildGenerationObservation({
      modelId: "qwen3-1.7b-q4f16",
      firstTokenTimeMs: 100,
      generationDurationMs: 2000,
      stopReason: "completed",
      now: FIXED_NOW,
    });
    for (const key of Object.keys(observation)) {
      expect(TECHNICAL_FIELD_ALLOWLIST.has(key)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { ModelBenchmarkOutcome } from "@free-ai-open/types";
import { classifyModelBenchmarkResultStability, classifyModelBenchmarkStability } from "./stability";

describe("classifyModelBenchmarkStability", () => {
  it("classifies an explicit natural completion as positive", () => {
    expect(classifyModelBenchmarkStability("completed")).toBe("positive");
  });

  it("classifies a user-initiated cancellation as neutral -- benchmark cancellation must never penalize the model", () => {
    expect(classifyModelBenchmarkStability("cancelled")).toBe("neutral");
  });

  it("classifies every neutral outcome as neutral, never positive or negative", () => {
    const neutralOutcomes: ModelBenchmarkOutcome[] = ["cancelled", "length_limited", "unsupported_tool_call", "terminal_unknown"];
    for (const outcome of neutralOutcomes) {
      expect(classifyModelBenchmarkStability(outcome)).toBe("neutral");
    }
  });

  it("classifies the benchmark-runner's own policy-deadline outcomes as neutral, never negative -- a runner limit is not model instability", () => {
    const runnerPolicyOutcomes: ModelBenchmarkOutcome[] = ["benchmark_timeout", "load_timeout"];
    for (const outcome of runnerPolicyOutcomes) {
      expect(classifyModelBenchmarkStability(outcome)).toBe("neutral");
    }
  });

  it("classifies every genuine-failure outcome as negative", () => {
    const negativeOutcomes: ModelBenchmarkOutcome[] = ["stalled", "degenerate", "out_of_memory", "device_lost", "load_failed"];
    for (const outcome of negativeOutcomes) {
      expect(classifyModelBenchmarkStability(outcome)).toBe("negative");
    }
  });

  it("fails closed (negative) for an outcome outside every known group", () => {
    expect(classifyModelBenchmarkStability("made_up_outcome" as ModelBenchmarkOutcome)).toBe("negative");
  });
});

describe("classifyModelBenchmarkResultStability", () => {
  const exactGeneration = (generatedTokenCount: number) =>
    ({
      tokenCountConfidence: "exact",
      generationDurationMs: 1000,
      generatedTokenCount,
      overallCompletionTokensPerSecond: generatedTokenCount,
    }) as const;

  it("classifies a completed run that really produced tokens as positive", () => {
    expect(classifyModelBenchmarkResultStability({ outcome: "completed", generation: exactGeneration(20) })).toBe("positive");
  });

  it("a 'completed' record with exactly ZERO generated tokens must never improve stability -- it is neutral, never positive", () => {
    expect(classifyModelBenchmarkResultStability({ outcome: "completed", generation: exactGeneration(0) })).toBe("neutral");
  });

  it("a completed record with unavailable usage keeps its outcome classification (the count is unknown, not zero)", () => {
    expect(
      classifyModelBenchmarkResultStability({
        outcome: "completed",
        generation: { tokenCountConfidence: "unavailable", generationDurationMs: 700 },
      })
    ).toBe("positive");
  });

  it("never turns an empty completion NEGATIVE, and leaves every other outcome to the outcome-level classifier", () => {
    expect(classifyModelBenchmarkResultStability({ outcome: "terminal_unknown", generation: exactGeneration(0) })).toBe("neutral");
    expect(classifyModelBenchmarkResultStability({ outcome: "stalled", generation: exactGeneration(0) })).toBe("negative");
  });
});

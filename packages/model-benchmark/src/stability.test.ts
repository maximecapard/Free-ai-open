import { describe, expect, it } from "vitest";
import type { ModelBenchmarkOutcome } from "@free-ai-open/types";
import { classifyModelBenchmarkStability } from "./stability";

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

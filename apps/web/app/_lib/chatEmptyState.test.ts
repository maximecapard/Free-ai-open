import { describe, expect, it } from "vitest";
import type { RouterDecision } from "@free-ai-open/model-router";
import { resolveChatEmptyStateReason } from "./chatEmptyState";

function decision(overrides: Partial<RouterDecision>): RouterDecision {
  return {
    selectedModelId: "smollm2-360m-instruct-q4f32",
    fallbackModelIds: [],
    confidence: "medium",
    reasons: [],
    warnings: [],
    rejectedModels: [],
    candidateScores: [],
    recommendedContextTokens: 2048,
    recommendedMaxOutputTokens: 512,
    registryVersion: "0.7.0-alpha.1",
    decisionVersion: "1.0.0:0.7.0-alpha.1",
    ...overrides,
  };
}

describe("resolveChatEmptyStateReason", () => {
  it("returns null when a model was selected and nothing relevant warned", () => {
    expect(resolveChatEmptyStateReason(decision({}))).toBeNull();
  });

  it("identifies WebGPU unavailability when every rejected model was blocked by backend availability", () => {
    const result = resolveChatEmptyStateReason(
      decision({
        selectedModelId: null,
        rejectedModels: [
          { modelId: "a", reasons: ["backend_unavailable"] },
          { modelId: "b", reasons: ["backend_unavailable"] },
        ],
      })
    );
    expect(result).toBe("webgpu_unavailable");
  });

  it("falls back to the generic no-eligible-model reason when rejections have mixed causes", () => {
    const result = resolveChatEmptyStateReason(
      decision({
        selectedModelId: null,
        rejectedModels: [
          { modelId: "a", reasons: ["backend_unavailable"] },
          { modelId: "b", reasons: ["insufficient_memory"] },
        ],
      })
    );
    expect(result).toBe("no_eligible_model");
  });

  it("falls back to the generic no-eligible-model reason when nothing was rejected but nothing was selected either", () => {
    expect(resolveChatEmptyStateReason(decision({ selectedModelId: null, rejectedModels: [] }))).toBe("no_eligible_model");
  });

  it("flags a manual model that is no longer eligible or unknown even though a fallback was selected", () => {
    expect(resolveChatEmptyStateReason(decision({ warnings: ["manual_model_ineligible"] }))).toBe(
      "manual_model_ineligible"
    );
    expect(resolveChatEmptyStateReason(decision({ warnings: ["manual_model_unknown"] }))).toBe(
      "manual_model_ineligible"
    );
  });
});

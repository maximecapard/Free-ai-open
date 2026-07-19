import { describe, expect, it } from "vitest";
import type { RouterDecision } from "@free-ai-open/model-router";
import { resolveManualModelEligibility } from "./manualModelEligibility";

function decisionWithRejected(rejectedModels: RouterDecision["rejectedModels"]): RouterDecision {
  return {
    selectedModelId: "smollm2-360m-instruct-q4f32",
    fallbackModelIds: [],
    confidence: "medium",
    reasons: [],
    warnings: [],
    rejectedModels,
    candidateScores: [],
    recommendedContextTokens: 2048,
    recommendedMaxOutputTokens: 512,
    registryVersion: "0.7.0-alpha.1",
    decisionVersion: "1.0.0:0.7.0-alpha.1",
  };
}

describe("resolveManualModelEligibility", () => {
  it("fails closed while no capability-backed decision has been computed", () => {
    expect(resolveManualModelEligibility(null, "qwen3-4b-q4f16")).toEqual({
      eligible: false,
      pending: true,
      rejectionReasons: [],
    });
  });

  it("is eligible when the model does not appear in rejectedModels", () => {
    const decision = decisionWithRejected([]);
    expect(resolveManualModelEligibility(decision, "qwen3-4b-q4f16")).toEqual({
      eligible: true,
      pending: false,
      rejectionReasons: [],
    });
  });

  it("is ineligible with the router's own rejection reasons when the model was rejected", () => {
    const decision = decisionWithRejected([
      { modelId: "qwen3-4b-q4f16", reasons: ["insufficient_memory", "form_factor_unsupported"] },
    ]);
    expect(resolveManualModelEligibility(decision, "qwen3-4b-q4f16")).toEqual({
      eligible: false,
      pending: false,
      rejectionReasons: ["insufficient_memory", "form_factor_unsupported"],
    });
  });

  it("only reports ineligibility for the specific model that was rejected", () => {
    const decision = decisionWithRejected([{ modelId: "qwen3-4b-q4f16", reasons: ["insufficient_memory"] }]);
    expect(resolveManualModelEligibility(decision, "smollm2-360m-instruct-q4f32")).toEqual({
      eligible: true,
      pending: false,
      rejectionReasons: [],
    });
  });
});

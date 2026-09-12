import { describe, expect, it } from "vitest";
import { modelUsesReasoningByDefault, outputTokenBudgetForCandidate, REASONING_OUTPUT_ALLOWANCE_TOKENS } from "./adaptiveOutputBudget";

describe("modelUsesReasoningByDefault", () => {
  it("identifies Qwen3 as a reasoning family", () => {
    expect(modelUsesReasoningByDefault("Qwen3")).toBe(true);
  });

  it("does not treat unrelated or similarly-named families as reasoning models", () => {
    expect(modelUsesReasoningByDefault("Qwen2.5-Coder")).toBe(false);
    expect(modelUsesReasoningByDefault("SmolLM2")).toBe(false);
    expect(modelUsesReasoningByDefault("")).toBe(false);
  });
});

describe("outputTokenBudgetForCandidate", () => {
  it("adds the reasoning allowance on top of the preset budget for a reasoning-family model", () => {
    expect(outputTokenBudgetForCandidate(512, { family: "Qwen3" })).toBe(512 + REASONING_OUTPUT_ALLOWANCE_TOKENS);
  });

  it("leaves the preset budget unchanged for a non-reasoning model", () => {
    expect(outputTokenBudgetForCandidate(512, { family: "Qwen2.5-Coder" })).toBe(512);
    expect(outputTokenBudgetForCandidate(256, { family: "SmolLM2" })).toBe(256);
  });
});
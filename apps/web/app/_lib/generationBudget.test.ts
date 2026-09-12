import { describe, expect, it } from "vitest";
import { GENERATION_SAFETY_LIMITS } from "@free-ai-open/ai-runtime";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import { estimateTokenCount } from "@free-ai-open/model-router";
import type { RouterDecision } from "@free-ai-open/model-router";
import { FALLBACK_CONTEXT_WINDOW_TOKENS, computeBudgetedOutputTokens } from "./generationBudget";

function fakeDecision(overrides: Partial<RouterDecision>): RouterDecision {
  return {
    selectedModelId: "qwen3-4b-instruct-q4f16",
    fallbackModelIds: [],
    confidence: "high",
    reasons: [],
    warnings: [],
    rejectedModels: [],
    candidateScores: [],
    recommendedContextTokens: 4096,
    recommendedMaxOutputTokens: 1024,
    registryVersion: "test",
    decisionVersion: "test",
    ...overrides,
  };
}

describe("computeBudgetedOutputTokens", () => {
  it("Qwen3 Fast (1024-token context): tightens output far below the preset's own max when the prompt is non-trivial", () => {
    const decision = fakeDecision({ recommendedContextTokens: 1024, recommendedMaxOutputTokens: 256 });
    const result = computeBudgetedOutputTokens(decision, "en", "Explain how binary search works, step by step.");

    expect(result.maxOutputTokens).toBeGreaterThan(0);
    expect(result.maxOutputTokens).toBeLessThanOrEqual(256);
    expect(result.insufficientContext).toBe(false);
  });

  it("Qwen3 Balanced (2048-token context) grants the full preset budget for a short prompt", () => {
    const decision = fakeDecision({ recommendedContextTokens: 2048, recommendedMaxOutputTokens: 512 });
    const result = computeBudgetedOutputTokens(decision, "en", "Hi");

    expect(result.maxOutputTokens).toBe(512);
    expect(result.insufficientContext).toBe(false);
  });

  it("Qwen3 Performance (4096-token context) grants the full reasoning-inclusive budget for a moderate prompt", () => {
    const decision = fakeDecision({ recommendedContextTokens: 4096, recommendedMaxOutputTokens: 1536 });
    const result = computeBudgetedOutputTokens(decision, "en", "Write a short story about a robot learning to paint.");

    expect(result.maxOutputTokens).toBe(1536);
    expect(result.insufficientContext).toBe(false);
  });

  it("a long Continue prompt that re-embeds a prior reply is tightened relative to a fresh short prompt on the same context window", () => {
    const decision = fakeDecision({ recommendedContextTokens: 2048, recommendedMaxOutputTokens: 512 });
    // Sized dynamically against the real estimator (rather than a hand-
    // counted literal) so this test does not depend on guessing byte
    // counts: enough repeats to estimate to roughly 1700 input tokens,
    // comfortably eating into the 2048-token window without exhausting it
    // completely -- see the dedicated "insufficientContext" regression
    // test below for the fully-exhausted case.
    const unit =
      "This sentence stands in for part of a long prior assistant reply that must be fully re-embedded as input so the model retains full context. ";
    const longPriorReply = unit.repeat(Math.ceil(1700 / estimateTokenCount(unit)));

    const shortResult = computeBudgetedOutputTokens(decision, "en", "Continue.");
    const continueResult = computeBudgetedOutputTokens(decision, "en", longPriorReply);

    expect(continueResult.maxOutputTokens).toBeLessThan(shortResult.maxOutputTokens);
    expect(continueResult.maxOutputTokens).toBeGreaterThan(0);
  });

  it("regression (item 3): a missing router decision (routing not resolved yet) still applies real context budgeting instead of skipping it -- fails closed rather than granting the raw global cap unchecked", () => {
    // Before the fix, routerDecision === null returned maxOutputTokens:
    // undefined and insufficientContext: false UNCONDITIONALLY, which let
    // ai-runtime's own GENERATION_SAFETY_LIMITS.maxTokens (2048) through
    // with zero context checking -- more than the entire 1024-token
    // "compatibility" context window some devices actually load.
    const result = computeBudgetedOutputTokens(null, "en", "Explain recursion.");

    expect(result.maxOutputTokens).toBeTypeOf("number");
    expect(result.maxOutputTokens).toBeLessThanOrEqual(GENERATION_SAFETY_LIMITS.maxTokens);
    // The whole point of the fix: the assumed context window is the
    // smallest the app could ever actually load, so the granted output
    // budget can never itself exceed what that window could hold.
    expect(result.maxOutputTokens).toBeLessThan(FALLBACK_CONTEXT_WINDOW_TOKENS);
  });

  it("regression (item 3): a missing router decision correctly reports insufficientContext for a prompt too long to leave any useful output room -- impossible before the fix, which always reported false", () => {
    const veryLongPrompt = "word ".repeat(400); // ~2000 bytes, well past the 1024-token fallback window
    const result = computeBudgetedOutputTokens(null, "en", veryLongPrompt);

    expect(result.insufficientContext).toBe(true);
  });

  it("a missing router decision with a short prompt still grants a real, useful, non-zero output budget", () => {
    const result = computeBudgetedOutputTokens(null, "en", "Hi");

    expect(result.insufficientContext).toBe(false);
    expect(result.maxOutputTokens).toBeGreaterThan(0);
  });

  it("the French system instruction's accented characters are counted correctly and do not themselves trigger insufficientContext for a normal prompt", () => {
    const decision = fakeDecision({ recommendedContextTokens: 2048, recommendedMaxOutputTokens: 512 });
    const result = computeBudgetedOutputTokens(decision, "fr", "Explique la récursivité simplement.");

    expect(result.insufficientContext).toBe(false);
    expect(result.maxOutputTokens).toBeGreaterThan(0);
  });
});

describe("FALLBACK_CONTEXT_WINDOW_TOKENS", () => {
  it("equals the smallest context preset across the entire live model registry, not a hardcoded literal that could drift", () => {
    const actualMinimum = Math.min(
      ...modelRegistryV2.flatMap((record) => record.contextPresets.map((preset) => preset.contextTokens))
    );
    expect(FALLBACK_CONTEXT_WINDOW_TOKENS).toBe(actualMinimum);
  });

  it("is never larger than any individual model's smallest context preset -- the safety property this constant exists for", () => {
    for (const record of modelRegistryV2) {
      const smallestForModel = Math.min(...record.contextPresets.map((preset) => preset.contextTokens));
      expect(FALLBACK_CONTEXT_WINDOW_TOKENS).toBeLessThanOrEqual(smallestForModel);
    }
  });
});

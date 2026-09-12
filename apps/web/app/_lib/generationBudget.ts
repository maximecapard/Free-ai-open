import { GENERATION_SAFETY_LIMITS, getRuntimeLanguageInstruction } from "@free-ai-open/ai-runtime";
import type { RuntimeLocale } from "@free-ai-open/ai-runtime";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import {
  CONTEXT_SAFETY_MARGIN_TOKENS,
  MINIMUM_USEFUL_OUTPUT_TOKENS,
  calculateGenerationBudget,
  estimateChatInputTokens,
} from "@free-ai-open/model-router";
import type { RouterDecision } from "@free-ai-open/model-router";

// The smallest context window ANY registry entry could ever load into,
// across every performance-mode preset -- see registry-v2.ts's
// contextPresets() helper, whose "compatibility" preset (1024 tokens today)
// is always the smallest and is shared by every model record. Used only as
// the assumed context window when there is no router decision yet to
// budget against (see computeBudgetedOutputTokens below): the safest
// assumption when the eventual target is unknown is the smallest window
// any model could actually be running with, never an average or a guess at
// what will load next. Derived from the live registry rather than a
// hardcoded literal so it can never silently drift out of sync with it.
export const FALLBACK_CONTEXT_WINDOW_TOKENS = Math.min(
  ...modelRegistryV2.flatMap((record) => record.contextPresets.map((preset) => preset.contextTokens))
);

export interface BudgetedOutputTokens {
  maxOutputTokens: number;
  insufficientContext: boolean;
}

// The context-safe output budget for one generation call: never more than
// the router's own recommendation (or, absent a decision, the global
// safety cap), tightened so that estimatedInputTokens + allowedOutputTokens
// + safety margin never exceeds the assumed context window -- see
// contextBudget.ts and docs/architecture.md's "Context-safe output
// budgeting" section.
//
// Second Codex review, item 3: EVERY generation path must go through this
// same resolver, including the case where routing has not produced a
// decision yet (e.g. the very first message before the performance-mode
// preference finishes loading, or capability detection has not resolved --
// see useAdaptiveRuntimeRouting.ts's evaluateRouting(), which can return
// null). Previously this case returned `maxOutputTokens: undefined` and
// skipped budgeting entirely, silently falling back to ai-runtime's own
// GENERATION_SAFETY_LIMITS.maxTokens (2048 tokens) with NO context check at
// all -- more than the ENTIRE 1024-token "compatibility" context window some
// devices actually load, which would guarantee an overflow the moment
// routing did resolve to that preset. Now this path is resolved through
// the exact same calculateGenerationBudget() call as every other path,
// against the smallest context window the app could ever load
// (FALLBACK_CONTEXT_WINDOW_TOKENS) and the global safety cap as the desired
// output -- i.e. finalOutput = min(desiredOutput, contextSafeOutput,
// globalSafetyLimit) holds here exactly as it does when a router decision
// is available.
export function computeBudgetedOutputTokens(
  routerDecision: RouterDecision | null,
  locale: RuntimeLocale,
  promptText: string
): BudgetedOutputTokens {
  const estimatedInputTokens = estimateChatInputTokens([getRuntimeLanguageInstruction(locale), promptText]);
  const contextWindow = routerDecision?.recommendedContextTokens ?? FALLBACK_CONTEXT_WINDOW_TOKENS;
  const desiredOutputTokens = routerDecision?.recommendedMaxOutputTokens ?? GENERATION_SAFETY_LIMITS.maxTokens;

  const budget = calculateGenerationBudget({
    contextWindow,
    estimatedInputTokens,
    desiredOutputTokens,
    minimumOutputTokens: MINIMUM_USEFUL_OUTPUT_TOKENS,
    safetyMargin: CONTEXT_SAFETY_MARGIN_TOKENS,
  });

  return {
    maxOutputTokens: budget.allowedOutputTokens,
    insufficientContext: budget.warning === "insufficient_context_for_minimum_output",
  };
}

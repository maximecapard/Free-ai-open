import type { ModelRegistryRecord } from "@free-ai-open/model-registry";

// Model families known to reason before answering by default in this
// registry (a Qwen3 chat-template response normally opens with a <think>
// block unless the caller explicitly disables it - see WebLLM's
// enable_thinking option, documented in docs/architecture.md's "Reasoning
// output and finish reason" section, which this hotfix does not wire up).
// A real generation on a Qwen3 model spent its entire output-token budget
// inside <think> and never reached a final answer; this allowance exists so
// that does not routinely happen again. Deliberately family-based (not a
// new model-registry field or a broader router-scoring change) to keep this
// fix narrow: it only ever widens the OUTPUT BUDGET for these families, and
// never affects which model is selected or how candidates are scored.
const REASONING_MODEL_FAMILIES: ReadonlySet<string> = new Set(["Qwen3"]);

// A real <think> block observed in production used several hundred tokens
// on its own before any final-answer text began. This allowance is added on
// top of the router's normal preset budget so a reasoning model has
// realistic room to finish thinking AND answer, without blindly raising the
// budget for every model regardless of whether it reasons at all.
export const REASONING_OUTPUT_ALLOWANCE_TOKENS = 512;

export function modelUsesReasoningByDefault(family: string): boolean {
  return REASONING_MODEL_FAMILIES.has(family);
}

export function outputTokenBudgetForCandidate(
  presetMaxOutputTokens: number,
  model: Pick<ModelRegistryRecord, "family">
): number {
  return modelUsesReasoningByDefault(model.family)
    ? presetMaxOutputTokens + REASONING_OUTPUT_ALLOWANCE_TOKENS
    : presetMaxOutputTokens;
}
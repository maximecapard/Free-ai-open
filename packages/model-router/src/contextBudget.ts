// Computes how many output tokens a generation can actually be given
// without risking overflowing the loaded model's context window, instead of
// requesting the router's preset output budget in isolation (the pre-fix
// behavior -- see docs/architecture.md's "Context-safe output budgeting"
// section). A real case this fixes: Qwen3 in "fast" performance mode loads
// a 1024-token context but the pre-fix code requested up to 768 output
// tokens regardless of input size, leaving as little as 256 tokens for the
// system instruction, the user's prompt, and (worst of all) a Continue
// request that re-embeds the entire prior partial reply.
//
// Token counting here is a documented, deliberately conservative byte-based
// estimate, not a real tokenizer: @mlc-ai/web-llm 0.2.84's public
// MLCEngine/WebWorkerMLCEngine classes -- the only ones ai-runtime's public
// surface uses -- expose no tokenize/countTokens/encode method. The
// `Tokenizer` type from @mlc-ai/web-tokenizers exists only as a PRIVATE
// field inside LLMChatPipeline, several layers below what the app can
// reach. Bundling a separate tokenizer just for this budget check would be
// a large, unjustified dependency for an alpha hotfix -- see
// estimateTokenCount()'s own doc comment for the exact heuristic and why it
// is safe to treat as an upper bound rather than a guess.
export const CONTEXT_SAFETY_MARGIN_TOKENS = 32;

// Below this many output tokens, a generation is not considered useful
// enough to start at all -- see calculateGenerationBudget()'s `warning`.
export const MINIMUM_USEFUL_OUTPUT_TOKENS = 64;

// A conservative allowance for the special tokens/role markers a chat
// template wraps around EVERY message (e.g. ChatML's
// "<|im_start|>{role}\n" ... "<|im_end|>\n"), which estimateTokenCount()
// cannot see on its own because those markers are added by the runtime's
// chat template, not present in the raw text being estimated. Deliberately
// generous relative to Qwen's actual ChatML overhead (a handful of tokens
// per message) so a stricter template used by some future registry entry
// is still covered. Applied once per segment by estimateChatInputTokens().
export const CHAT_MESSAGE_OVERHEAD_TOKENS = 16;

// A conservative (deliberately over-)estimate of how many tokens a string
// will consume once tokenized, expressed as its UTF-8 BYTE length with no
// further division.
//
// This is a genuine upper bound -- not merely a rough guess -- for every
// tokenizer family in real use by current open-weight chat models. Byte-
// level BPE (the scheme behind GPT-2/3/4, and LLaMA/Mistral/Qwen-family
// tokenizers) builds its vocabulary by merging adjacent BYTES into single
// tokens: merging can only ever REDUCE the token count relative to the raw
// byte count, never increase it, and no token can ever represent less than
// one byte. The same bound holds for SentencePiece-with-byte-fallback and
// character-level schemes, since neither can split a single byte across
// multiple tokens either. In other words: token count <= UTF-8 byte length
// is structurally guaranteed by how these tokenizers are built, not just
// empirically likely.
//
// This is why byte length -- not character length -- is used. The previous
// `characters / 3` estimate assumed roughly 3 characters per token, which
// is only safe for plain ASCII: a single accented letter, emoji, or CJK
// character can be 2-4 UTF-8 bytes wide while still counting as ONE
// JavaScript character, so it silently UNDER-estimated dense Unicode,
// source code, and Markdown-heavy text -- exactly the failure mode this
// budget check exists to prevent. See contextBudget.test.ts's adversarial
// fixtures (French accents, emoji, CJK, punctuation-heavy text, source
// code, Markdown fences).
//
// No public tokenizer or token-count API is available to count exactly
// instead of estimating (see this module's top doc comment). If one ever
// becomes available, prefer it and report "exact" confidence rather than
// computing this estimate at all -- see GenerationBudgetResult.confidence.
export function estimateTokenCount(text: string): number {
  return new TextEncoder().encode(text).length;
}

// Estimates the total input token cost of a chat request as a conservative
// upper bound: every non-empty segment (the system language instruction,
// the user/continuation prompt, a re-embedded prior reply, etc.) is counted
// separately and each pays its own CHAT_MESSAGE_OVERHEAD_TOKENS, since a
// real chat template wraps each message individually with its own role
// markers rather than concatenating everything into one message. An empty
// segment contributes nothing -- no chat template emits a message for
// content that does not exist, so charging overhead for it would not make
// the estimate safer, only less accurate.
export function estimateChatInputTokens(segments: readonly string[]): number {
  return segments.reduce(
    (total, segment) => (segment.length === 0 ? total : total + estimateTokenCount(segment) + CHAT_MESSAGE_OVERHEAD_TOKENS),
    0
  );
}

export interface GenerationBudgetInput {
  // The loaded model's context window, in tokens (e.g. the adaptive
  // router's selected preset's contextTokens / RouterDecision's
  // recommendedContextTokens).
  contextWindow: number;
  // A conservative estimate of everything that will be sent as input for
  // this generation: the system language instruction plus the user/
  // continuation prompt (see estimateChatInputTokens()).
  estimatedInputTokens: number;
  // What the caller would like to request (e.g. the router's
  // recommendedMaxOutputTokens, already including any reasoning-family
  // allowance).
  desiredOutputTokens: number;
  // Below this many output tokens, generating is not considered useful.
  minimumOutputTokens: number;
  // Extra headroom subtracted on top of the input estimate, covering
  // whatever the estimator's own (already conservative) heuristic and the
  // per-message overhead allowance still might not fully capture.
  safetyMargin: number;
}

export interface GenerationBudgetResult {
  // The output-token budget it is actually safe to request, already clamped
  // to [0, desiredOutputTokens]. Callers must use this instead of the raw
  // desiredOutputTokens -- see calculateGenerationBudget()'s doc comment.
  allowedOutputTokens: number;
  // How much context remains after subtracting the input estimate and the
  // safety margin, before also clamping to desiredOutputTokens. Useful for
  // diagnostics/explanations even when it exceeds what was actually needed.
  remainingContextTokens: number;
  // Always "conservative": estimatedInputTokens is a byte-based estimate,
  // not a real token count (see estimateTokenCount()'s doc comment for why
  // no public WebLLM tokenizer API is available to count exactly instead).
  // Surfaced explicitly so callers/UI never present this budget as more
  // precise than it is. "exact" is reserved for if/when a real per-model
  // tokenizer becomes reachable from the app layer -- there is no code path
  // that produces it today.
  confidence: "exact" | "conservative";
  // Present only when allowedOutputTokens would fall below
  // minimumOutputTokens -- the caller should not start this generation.
  warning?: "insufficient_context_for_minimum_output";
}

// Required invariant this function enforces:
//   estimatedInputTokens + allowedOutputTokens + safetyMargin <= contextWindow
// (assuming desiredOutputTokens is not already smaller than what that
// invariant would allow, in which case allowedOutputTokens is simply
// desiredOutputTokens -- this function only ever tightens the requested
// budget, the same "ceiling, never an increase" rule the global safety cap
// already follows elsewhere in ai-runtime).
export function calculateGenerationBudget(input: GenerationBudgetInput): GenerationBudgetResult {
  const remainingContextTokens = Math.max(
    0,
    input.contextWindow - input.estimatedInputTokens - input.safetyMargin
  );
  const allowedOutputTokens = Math.max(0, Math.min(input.desiredOutputTokens, remainingContextTokens));

  if (allowedOutputTokens < input.minimumOutputTokens) {
    return {
      allowedOutputTokens,
      remainingContextTokens,
      confidence: "conservative",
      warning: "insufficient_context_for_minimum_output",
    };
  }

  return { allowedOutputTokens, remainingContextTokens, confidence: "conservative" };
}

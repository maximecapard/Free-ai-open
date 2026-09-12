// Mirrors @mlc-ai/web-llm's internal (unexported) ChatWorker interface so
// callers can pass a real Worker without this package importing that type.
export interface InferenceChatWorker {
  postMessage: (message: unknown) => void;
  onmessage: unknown;
}

export type RuntimeStatus = "idle" | "loading_model" | "ready" | "generating" | "cancelling" | "recovering" | "error";

export type RuntimeErrorCode =
  | "webgpu_unavailable"
  | "gpu_feature_unsupported"
  | "model_unsupported"
  | "model_load_failed"
  | "generation_interrupted"
  | "cancel_timeout"
  | "generation_stalled"
  | "generation_exceeded_safety_limit"
  | "degenerate_output"
  | "out_of_memory"
  | "unknown";

export interface RuntimeError {
  code: RuntimeErrorCode;
  message: string;
}

export interface RuntimeState {
  status: RuntimeStatus;
  modelId: string | null;
  loadProgress: number;
  error: RuntimeError | null;
}

export type RuntimeLocale = "en" | "fr";

export interface GenerateInput {
  conversationId: string;
  prompt: string;
  responseLocale?: RuntimeLocale;
  // An upper bound suggested by the adaptive router's selected context/output
  // preset for the loaded model. Never raises generation above the existing
  // alpha safety cap (GENERATION_SAFETY_LIMITS.maxTokens) — see generate()'s
  // use of Math.min(). Omit to use the safety cap alone, as before.
  maxOutputTokens?: number;
}

// Every terminal outcome runtime.ts's generate() can report, mapped
// exhaustively (see mapFinishReason() in runtime.ts) from WebLLM's own
// ChatCompletionFinishReason ("stop" | "length" | "tool_calls" | "abort")
// plus two runtime-only outcomes for cases WebLLM itself never signals with
// an explicit reason. This union is deliberately closed and reviewed rather
// than "any string": a new WebLLM finish reason must be added here and
// handled by name in mapFinishReason()'s exhaustive switch, or the runtime
// fails to compile - it can never silently fall through to "completed".
//
// - "completed": WebLLM's own "stop" - a genuine natural end of turn.
// - "length": WebLLM's own "length" - the configured max_tokens budget was
//   exhausted before the model produced a natural stop. The response may be
//   truncated mid-thought; never a completed answer, never a stall/failure
//   (the model was actively producing valid output the whole time).
// - "cancelled": either a user-requested Stop (WebLLM's "abort") or a
//   runtime-classified cancellation (see errors.ts).
// - "degenerate_output": the app's own safety detector stopped generation
//   because the output became unstable (repeated characters/symbols, an
//   unbroken sequence, or exceeded the character cap) - never a WebLLM
//   finish_reason.
// - "unsupported_tool_call": WebLLM's own "tool_calls" - FreeAI Open never
//   requests tool use (no `tools` array is ever passed to
//   engine.chat.completions.create()), so this should not occur in normal
//   operation, but if a future WebLLM/model behavior ever produces it, it
//   must never be scored as model instability or silently treated as a
//   successful reply - see docs/architecture.md's finish-reason section.
// - "unknown_terminal": the stream ended without ANY chunk ever carrying a
//   finish_reason at all (not one of WebLLM's documented values, just
//   genuinely absent). This is the runtime failing closed rather than
//   assuming success: an unexplained stream end is never "completed".
export type GenerationStopReason =
  | "completed"
  | "length"
  | "cancelled"
  | "degenerate_output"
  | "unsupported_tool_call"
  | "unknown_terminal";

export type GenerateChunk =
  | { type: "token"; text: string }
  | { type: "done"; reason: GenerationStopReason }
  | { type: "error"; error: RuntimeError };

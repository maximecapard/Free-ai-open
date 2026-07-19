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

export type GenerationStopReason = "completed" | "cancelled" | "degenerate_output";

export type GenerateChunk =
  | { type: "token"; text: string }
  | { type: "done"; reason: GenerationStopReason }
  | { type: "error"; error: RuntimeError };

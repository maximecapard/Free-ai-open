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

// Real, tokenizer-backed usage the installed WebLLM runtime (verified
// against @mlc-ai/web-llm 0.2.84 -- see runtime.ts's own top-of-file note)
// reports on a dedicated trailer chunk when a request sets
// `stream_options: {include_usage: true}`. Deliberately a package-local
// shape, NOT imported from @free-ai-open/types' ModelBenchmarkGenerationMeasurement:
// ai-runtime must not take on a new dependency merely to reuse a type (see
// docs/architecture.md's "Package boundaries" section). A future benchmark-
// runner phase is responsible for translating this into the Phase-0
// persisted contract, exactly as apps/web already translates raw
// ai-runtime chunks into ModelPerformanceObservation today.
export interface GenerationTokenUsageExact {
  tokenCountConfidence: "exact";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // completionTokens divided by ai-runtime's OWN measured FULL inference
  // wall-clock duration (GenerationRuntimeMetrics.generationDurationMs) --
  // the interval from immediately before the WebLLM completion request to
  // the moment the complete stream, INCLUDING the usage trailer chunk, has
  // been fully consumed (see generationDurationMs's own doc comment
  // below). This necessarily includes worker/request scheduling overhead,
  // prefill, time to first token, first-token sampling, decode, stream
  // delivery, and the wait for the usage trailer itself -- it is NOT
  // decode-only throughput, and this field is deliberately named to make
  // that unambiguous (never "decodeTokensPerSecond"/"generationSpeed"/
  // "decode throughput" -- a name suggesting decode-only speed would
  // invite a future consumer, e.g. a Phase-2 benchmark runner, to treat it
  // as one). Always a finite, well-defined number in this variant, never
  // null: this variant is only ever constructed once generationDurationMs
  // is confirmed strictly positive (see runtime.ts's
  // buildGenerationTokenUsage()), so there is no "exact but underivable
  // rate" state left to represent.
  //
  // Deliberately NEVER WebLLM's own self-reported
  // `usage.extra.decode_tokens_per_s` (measured against a different
  // internal clock), which could diverge from this package's own
  // generationDurationMs by more than a later consistency check's
  // tolerance, producing an internally-inconsistent record.
  //
  // No prompt/prefill throughput field exists on this type. WebLLM's own
  // `usage.extra.prefill_tokens_per_s` is real, but this package does not
  // promote it into this trusted contract, and `promptTokens /
  // timeToFirstTokenMs` is NOT exact prefill throughput either -- TTFT
  // includes worker/message round-trip, request scheduling, first-token
  // sampling, and delivery of the first chunk, not just prefill. Neither
  // is trustworthy enough to sit inside an object whose own discriminant
  // claims "exact". If a future phase needs prompt throughput, it needs
  // its own explicit provenance/confidence field, not this one.
  overallCompletionTokensPerSecond: number;
}

// No real token count is available for this generation attempt -- either
// the installed runtime did not report a usage payload at all, or the
// reported payload failed validation (non-integer, negative, or an
// internally-inconsistent total). Never estimated from characters, bytes,
// words, or chunk counts -- see buildGenerationTokenUsage()'s own comment.
export interface GenerationTokenUsageUnavailable {
  tokenCountConfidence: "unavailable";
}

export type GenerationTokenUsage = GenerationTokenUsageExact | GenerationTokenUsageUnavailable;

// One generation attempt's raw runtime-measured performance, attached to
// the terminal "done" chunk generate() yields below. Never aggregated
// across separate generate() calls: each Continue attempt (see
// apps/web/app/_lib/continuationExecution.ts) is its own independent call
// with its own independent metrics object -- there is no runtime-level
// accumulation across attempts.
export interface GenerationRuntimeMetrics {
  // Epoch ms when this generation's inference request was actually made --
  // never the moment the model finished loading (see ModelLoadRuntimeMetrics
  // below, a wholly separate measurement).
  inferenceStartedAt: number;
  // Epoch ms of the earliest RAW runtime chunk carrying generated content,
  // captured from the exact same raw stream iteration the generation
  // watchdog itself reads (see runtime.ts's generate() loop) -- never from
  // React rendering, buffered transcript flushes, or any downstream
  // consumer. `null` when no content chunk ever arrived.
  firstTokenAt: number | null;
  // Time from inference start to the earliest real content output (see
  // firstTokenAt above) -- NOT a prefill-time measurement. The gap
  // necessarily also includes worker/message round-trip, request
  // scheduling, and first-token sampling before that first chunk is
  // delivered, so this must never be reinterpreted as "how long prefill
  // took" by a future consumer.
  timeToFirstTokenMs: number | null;
  // Epoch ms when generate()'s own stream loop actually finished consuming
  // the stream (or was interrupted) -- independent of whatever downstream
  // processing happens afterward.
  completedAt: number;
  // The FULL ai-runtime inference wall-clock duration: measured from
  // immediately before the WebLLM completion request until the complete
  // response stream -- INCLUDING WebLLM's own usage trailer chunk (see
  // runtime.ts's own top-of-file note on `stream_options.include_usage`)
  // -- has been fully consumed. It therefore includes prefill and time to
  // first token; it is NOT decode-only duration. This is the denominator
  // `GenerationTokenUsageExact.overallCompletionTokensPerSecond` divides
  // by -- see that field's own doc comment for the full reasoning.
  generationDurationMs: number;
  usage: GenerationTokenUsage;
}

// loadModel()'s own raw measurement, kept entirely separate from
// GenerationRuntimeMetrics since loading and generating are different
// runtime operations with different callers/timing. `loadTimeMs` is always
// however long THIS loadModel() call actually took: the installed WebLLM
// version does not expose a structured download-vs-initialization split
// (InitProgressReport's `text` field is free-form, not a structured phase
// enum -- see runtime.ts's own note), so this number may include either a
// real network download or a fast cache-hit initialization, and is
// honestly labeled as "however long this call took" rather than mislabeled
// as pure "download time". There is deliberately no "model already loaded,
// reused" case here: loadModel() always performs a real
// CreateWebWorkerMLCEngine() call when invoked, so whether a caller even
// calls loadModel() again for an already-ready model (in which case there
// is simply no ModelLoadRuntimeMetrics at all for that generation) is a
// decision made above this package.
export interface ModelLoadRuntimeMetrics {
  loadTimeMs: number;
}

export type GenerateChunk =
  | { type: "token"; text: string }
  | { type: "done"; reason: GenerationStopReason; metrics: GenerationRuntimeMetrics }
  | { type: "error"; error: RuntimeError };

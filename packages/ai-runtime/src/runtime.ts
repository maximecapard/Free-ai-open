// Verified against the installed @mlc-ai/web-llm version (0.2.84 -- see
// packages/ai-runtime/package.json and pnpm-lock.yaml). This exact version's
// `lib/openai_api_protocols/chat_completion.d.ts`/`types.d.ts` were read
// directly (never assumed from memory or from web-llm's own docs, which can
// describe a different installed version) before writing the usage-capture
// logic below. What that inspection found:
// - `ChatCompletionRequestBase.stream_options?: {include_usage?: boolean}`
//   is fully supported (`ChatCompletionRequestUnsupportedFields` is an empty
//   array in this version's compiled bundle -- "all supported as of now").
// - With `stream_options: {include_usage: true}` set, a NORMAL (non-
//   interrupted) stream ends with: ...content chunks with `usage` absent...,
//   then the usual last chunk carrying `finish_reason` (still `usage`
//   absent), then ONE EXTRA trailer chunk with `choices: []` and a populated
//   `usage: CompletionUsage`. This trailer is only ever reached on a clean
//   stream end -- interrupted/aborted/degenerate-output paths never see it
//   (see the `abort`-triggered `break` in the loop below, and the catch/
//   forced-recovery paths, none of which continue iterating far enough to
//   receive it), so those paths always report `tokenCountConfidence:
//   "unavailable"`, honestly.
// - `CompletionUsage.completion_tokens`/`prompt_tokens`/`total_tokens` are
//   real tokenizer-backed counts computed internally by WebLLM's own
//   pipeline (`getCurRoundDecodingTotalTokens()`/`getCurRoundPrefillTotalTokens()`),
//   not derived from characters/words/chunks -- these are trustworthy as
//   "exact" once individually validated (see buildGenerationTokenUsage()).
// - `CompletionUsage.extra` additionally exposes WebLLM's own self-measured
//   `prefill_tokens_per_s`/`decode_tokens_per_s`/`e2e_latency_s`/
//   `time_to_first_token_s` (and an opt-in `latencyBreakdown`). Deliberately
//   NOT used here: mixing WebLLM's internal clock with this package's own
//   wall-clock `generationDurationMs` risks producing a rate that fails a
//   later consistency check even though each half is individually correct.
//   `GenerationTokenUsageExact.overallCompletionTokensPerSecond` below is
//   always derived from this package's OWN measured durations instead, so
//   it is self-consistent by construction. A future phase may still choose
//   to surface `extra.*` separately for diagnostics.
// - `generationDurationMs` (the denominator of
//   `overallCompletionTokensPerSecond`) spans the FULL inference call: from
//   immediately before `engine.chat.completions.create()` to the moment the
//   entire stream -- INCLUDING the usage trailer chunk above -- has been
//   consumed. It therefore includes worker/request overhead, prefill, time
//   to first token, first-token sampling, decode, stream delivery, and the
//   wait for the usage trailer itself. `overallCompletionTokensPerSecond`
//   is named the way it is specifically so it can never be mistaken for a
//   decode-only rate ("tokens/sec while actively generating") -- it is an
//   end-to-end completion-token rate, not `decodeTokensPerSecond`. WebLLM's
//   own `usage.extra.prefill_tokens_per_s` is real prefill throughput, but
//   this package does not promote it into this contract, and
//   `promptTokens / timeToFirstTokenMs` would NOT be exact prefill
//   throughput either (TTFT includes more than prefill -- see
//   `timeToFirstTokenMs`'s own doc comment in types.ts) -- so no prompt/
//   prefill throughput field exists here at all.
import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { ChatCompletionFinishReason, CompletionUsage, InitProgressReport, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { detectWebGPUAvailability } from "@free-ai-open/device-profiler";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { classifyRuntimeError } from "./errors";
import { detectDegenerateOutput, GENERATION_SAFETY_LIMITS } from "./generation-safety";
import { createGenerationWatchdog } from "./generationWatchdog";
import { getRuntimeLanguageInstruction } from "./language-instruction";
import { recordLocalLog, toLocalLogErrorCode, toLocalLogModelId } from "./local-log-bridge";
import { DEFAULT_MODEL_ID } from "./model";
import type { DegenerateOutputReason } from "./generation-safety";
import type { GenerationWatchdog } from "./generationWatchdog";
import type {
  GenerateChunk,
  GenerateInput,
  GenerationRuntimeMetrics,
  GenerationStopReason,
  GenerationTokenUsage,
  InferenceChatWorker,
  ModelLoadRuntimeMetrics,
  RuntimeError,
  RuntimeState,
  RuntimeStatus,
} from "./types";

export interface LoadModelOptions {
  initialStatus?: Extract<RuntimeStatus, "loading_model" | "recovering">;
  contextWindowTokens?: number;
}

export interface InferenceRuntime {
  getState(): RuntimeState;
  subscribe(listener: (state: RuntimeState) => void): () => void;
  // Resolves to this call's own load metrics on success, `null` on failure
  // (WebGPU unavailable, or the load itself throwing) -- see
  // ModelLoadRuntimeMetrics's own doc comment in types.ts for exactly what
  // this number does and does not represent.
  loadModel(modelId?: string, options?: LoadModelOptions): Promise<ModelLoadRuntimeMetrics | null>;
  generate(input: GenerateInput): AsyncGenerator<GenerateChunk>;
  stopGeneration(): void;
  // Lets the app layer (which owns document.visibilityState — see
  // docs/architecture.md's watchdog section) pause inactivity detection
  // while the tab is hidden. Background tab throttling can delay both timer
  // firing and worker message delivery in ways that look identical to a
  // genuine stall; this is a no-op when no generation is active.
  setGenerationWatchdogSuspended(suspended: boolean): void;
  dispose(): Promise<void>;
}

const IDLE_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };

// @mlc-ai/web-llm's interruptGenerate() only posts a "please stop" message to
// the worker; it does not confirm the worker ever noticed. If the underlying
// decode loop is wedged, the stream never yields a chunk with
// finish_reason: "abort" and the runtime would otherwise stay stuck in
// "generating" forever. This bounds how long we wait for that confirmation
// before surfacing a recoverable error instead of hanging indefinitely.
const CANCEL_TIMEOUT_MS = 15_000;

// Two distinct "no progress" watchdog phases, both driven by
// generationWatchdog.ts. FIRST_TOKEN_TIMEOUT_MS bounds how long we wait for
// the very first token/chunk after inference starts (covers model
// prefill/tokenization time). STALL_TIMEOUT_MS bounds the gap between any
// two subsequent tokens/chunks once streaming has begun, and is re-armed on
// every one of them — it is a genuine inactivity detector, not a duration
// cap, so a generation that keeps producing output never trips it no matter
// how long it runs in total.
const FIRST_TOKEN_TIMEOUT_MS = 45_000;
const STALL_TIMEOUT_MS = 45_000;

// A wholly separate, much larger emergency cap on total generation
// duration, kept only to bound truly pathological runaway execution (e.g. a
// stream that keeps producing progress events fast enough to dodge the
// stall watchdog forever). It intentionally does not share a name or an
// error code with the stall/first-token watchdog above: it must never fire
// against a healthy, actively-streaming generation under normal conditions,
// so it is set far above the worst-case time to exhaust
// GENERATION_SAFETY_LIMITS.maxTokens even on a very slow device. See
// docs/architecture.md's watchdog section.
const ABSOLUTE_GENERATION_SAFETY_LIMIT_MS = 600_000;

// Maps WebLLM's own finish_reason to this package's GenerationStopReason,
// exhaustively and without any catch-all "assume success" branch (see
// GenerationStopReason's own doc comment in types.ts and
// docs/architecture.md's finish-reason section - this fixes a real bug where
// every finish_reason except "length"/"abort" silently became "completed").
//
// - null/undefined: the stream ended without ANY chunk ever carrying a
//   finish_reason at all - fail closed as "unknown_terminal" rather than
//   assume the model finished normally.
// - "stop": a genuine natural end of turn - the only value that becomes
//   "completed".
// - "length": the output-token budget was exhausted first.
// - "tool_calls": FreeAI Open never requests tool use, so this should not
//   occur, but if it ever does it must not be scored as model instability
//   nor silently accepted as a normal reply.
// - "abort": WebLLM's own cancellation signal (also handled explicitly by
//   the `cancelled` flag at the call site the instant it is seen, so this
//   branch is a defensive fallback, not the primary path).
//
// The `default` branch assigns `finishReason` to a `never`-typed binding: if
// @mlc-ai/web-llm ever adds a new ChatCompletionFinishReason literal, this
// function fails to COMPILE at that line instead of silently reaching a
// default that maps it to "completed". Fixing the resulting type error by
// adding an explicit case is the required response, not widening the type.
function mapFinishReason(finishReason: ChatCompletionFinishReason | null, cancelled: boolean): GenerationStopReason {
  if (cancelled) return "cancelled";
  if (finishReason === null || finishReason === undefined) return "unknown_terminal";

  switch (finishReason) {
    case "stop":
      return "completed";
    case "length":
      return "length";
    case "tool_calls":
      return "unsupported_tool_call";
    case "abort":
      return "cancelled";
    default: {
      // Compile-time exhaustiveness: a future WebLLM finish reason narrows
      // `finishReason` to something other than `never` here, so adding one
      // fails to compile at this line until an explicit case is added above.
      const exhaustiveCheck: never = finishReason;
      void exhaustiveCheck;
      // Runtime fail-closed guard, independent of the compile-time check
      // above: WebLLM's actual JS value crossing the worker boundary is
      // never verified against this type, so a genuinely unrecognized
      // string arriving in production must still be treated as an explicit
      // incomplete outcome - never passed through raw or assumed successful.
      return "unknown_terminal";
    }
  }
}

function stopEventNameFor(stopReason: GenerationStopReason): string {
  switch (stopReason) {
    case "cancelled":
      return "inference.cancelled";
    case "length":
      return "inference.length-limited";
    case "unsupported_tool_call":
      return "inference.unsupported-tool-call";
    case "unknown_terminal":
      return "inference.unknown-terminal";
    case "degenerate_output":
      return "inference.degenerate-output";
    case "completed":
      return "inference.completed";
  }
}

// Must only be called from a Client Component, never from a Server Component.
export function createInferenceRuntime(worker: InferenceChatWorker): InferenceRuntime {
  let state: RuntimeState = { ...IDLE_STATE };
  let engine: WebWorkerMLCEngine | null = null;
  const listeners = new Set<(state: RuntimeState) => void>();

  // Bumped on every new generate() call and whenever a generation is force-
  // resolved by one of the timeouts below. A generate() call only commits
  // its final state/log once it confirms it is still the current
  // generation, so a late-arriving chunk from an abandoned, timed-out
  // generation can never clobber state that has already moved on.
  let generationEpoch = 0;
  let cancelTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let safetyLimitTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const forcedRecoveryErrors = new Map<number, RuntimeError>();
  // The single in-flight generation's watchdog (see generationWatchdog.ts).
  // Only one generation can ever be active at a time (generate() refuses to
  // start a new one unless status is "ready"), so this — like the timeout
  // handles above — is safely runtime-scoped rather than per-call.
  let currentWatchdog: GenerationWatchdog | null = null;
  let watchdogSuspended = false;

  function setState(next: Partial<RuntimeState>): void {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  }

  function clearCancelTimeout(): void {
    if (cancelTimeoutHandle !== null) {
      clearTimeout(cancelTimeoutHandle);
      cancelTimeoutHandle = null;
    }
  }

  function clearSafetyLimitTimeout(): void {
    if (safetyLimitTimeoutHandle !== null) {
      clearTimeout(safetyLimitTimeoutHandle);
      safetyLimitTimeoutHandle = null;
    }
  }

  function disposeWatchdog(): void {
    currentWatchdog?.dispose();
    currentWatchdog = null;
  }

  // Shared by the cancel-confirmation timeout, the generation watchdog, and
  // the absolute safety limit: forces the runtime into a recoverable error
  // state, but only if nothing has resolved this same generation already.
  function forceRecovery(expectedEpoch: number, error: RuntimeError, event: string, localModelId: string | undefined): void {
    if (expectedEpoch !== generationEpoch) return;
    forcedRecoveryErrors.set(expectedEpoch, error);
    generationEpoch += 1;
    clearCancelTimeout();
    disposeWatchdog();
    clearSafetyLimitTimeout();
    engine?.interruptGenerate();
    setState({ status: "error", error });
    logEvent(createLogEvent(event, "error", { errorCode: error.code }));
    recordLocalLog({
      event,
      severity: "error",
      modelId: localModelId,
      runtimeStatus: "error",
      errorCode: toLocalLogErrorCode(error.code),
    });
  }

  function takeForcedRecoveryError(expectedEpoch: number): RuntimeError | null {
    const error = forcedRecoveryErrors.get(expectedEpoch) ?? null;
    forcedRecoveryErrors.delete(expectedEpoch);
    return error;
  }

  // This heuristic, chunk-count-derived `tokensPerSecond` is used ONLY for
  // the existing local technical log entry below -- it is never mixed into
  // GenerationRuntimeMetrics/GenerationTokenUsage (built by
  // buildGenerationTokenUsage() below from WebLLM's own exact usage
  // payload). Keeping these two computations entirely separate is
  // deliberate: a chunk count is not a token count, and this package must
  // never let an approximate, internally-used estimate be mistaken for an
  // authoritative benchmark/performance metric.
  function buildGenerationMetrics(generationStartedAt: number, firstTokenAt: number | null, tokenCount: number) {
    const totalTimeMs = Date.now() - generationStartedAt;
    const firstTokenMs = firstTokenAt !== null ? firstTokenAt - generationStartedAt : null;
    const tokensPerSecond =
      tokenCount > 0 && totalTimeMs > 0 ? Math.round((tokenCount / (totalTimeMs / 1000)) * 10) / 10 : undefined;

    return { firstTokenMs, tokensPerSecond, totalTimeMs };
  }

  function isFiniteNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
  }

  // Validates WebLLM's own raw usage payload and, only once every field
  // passes, derives a self-consistent OVERALL (not decode-only) throughput
  // figure from THIS package's own measured FULL inference duration (see
  // this file's top-of-file WebLLM API note for why WebLLM's self-reported
  // `extra.*` rates are deliberately not used here, and
  // GenerationTokenUsageExact's own doc comment in types.ts for the exact
  // denominator this divides by). Any single impossible value -- a
  // non-integer, a negative count, or a total that does not equal
  // prompt+completion -- degrades the WHOLE usage object to "unavailable"
  // rather than trusting a partially-valid payload; a missing/absent
  // payload does the same. `generationDurationMs` must be strictly
  // positive for an "exact" result to be constructed at all (mirrors
  // @free-ai-open/model-benchmark's own sanitizeGeneration() rule), so
  // overallCompletionTokensPerSecond is always a well-defined, finite
  // number within the "exact" variant -- never computed against a
  // zero/negative duration. No prompt/prefill throughput is derived here at
  // all -- `promptTokens / timeToFirstTokenMs` would not be exact prefill
  // throughput (see types.ts), so it is never exposed as one.
  function buildGenerationTokenUsage(rawUsage: CompletionUsage | undefined, generationDurationMs: number): GenerationTokenUsage {
    const unavailable: GenerationTokenUsage = { tokenCountConfidence: "unavailable" };
    if (!rawUsage) return unavailable;
    if (
      !isFiniteNonNegativeInteger(rawUsage.completion_tokens) ||
      !isFiniteNonNegativeInteger(rawUsage.prompt_tokens) ||
      !isFiniteNonNegativeInteger(rawUsage.total_tokens)
    ) {
      return unavailable;
    }
    if (rawUsage.total_tokens !== rawUsage.prompt_tokens + rawUsage.completion_tokens) return unavailable;
    if (!(generationDurationMs > 0)) return unavailable;

    const overallCompletionTokensPerSecond = rawUsage.completion_tokens / (generationDurationMs / 1000);

    return {
      tokenCountConfidence: "exact",
      promptTokens: rawUsage.prompt_tokens,
      completionTokens: rawUsage.completion_tokens,
      totalTokens: rawUsage.total_tokens,
      overallCompletionTokensPerSecond,
    };
  }

  // The single place `{type: "done", ...}` metrics are assembled, whichever
  // yield site is calling it, so every site derives `completedAt`/
  // `generationDurationMs` the exact same way (arithmetically from
  // `generationStartedAt` + the already-computed `totalTimeMs`, never a
  // fresh Date.now() call -- see this file's own test suite for why
  // avoiding an extra timer read here keeps deterministic timestamp-mocked
  // tests stable).
  function buildDoneMetrics(
    generationStartedAt: number,
    firstTokenAt: number | null,
    firstTokenMs: number | null,
    totalTimeMs: number,
    rawUsage: CompletionUsage | undefined
  ): GenerationRuntimeMetrics {
    return {
      inferenceStartedAt: generationStartedAt,
      firstTokenAt,
      timeToFirstTokenMs: firstTokenMs,
      completedAt: generationStartedAt + totalTimeMs,
      generationDurationMs: totalTimeMs,
      usage: buildGenerationTokenUsage(rawUsage, totalTimeMs),
    };
  }

  function recoverFromDegenerateOutput(
    expectedEpoch: number,
    reason: DegenerateOutputReason,
    generationStartedAt: number,
    firstTokenAt: number | null,
    tokenCount: number,
    responseLength: number,
    localModelId: string | undefined,
    conversationId: string
  ): { error: RuntimeError; metrics: GenerationRuntimeMetrics } {
    const error: RuntimeError = {
      code: "degenerate_output",
      message: "Generation stopped because the local model output became unstable.",
    };
    const generationMetrics = buildGenerationMetrics(generationStartedAt, firstTokenAt, tokenCount);
    // The stream was actively interrupted (engine.interruptGenerate() below)
    // before it could ever naturally reach WebLLM's usage trailer chunk --
    // there is no real usage payload to report here, ever.
    const metrics = buildDoneMetrics(generationStartedAt, firstTokenAt, generationMetrics.firstTokenMs, generationMetrics.totalTimeMs, undefined);

    if (expectedEpoch !== generationEpoch) return { error, metrics };
    generationEpoch += 1;
    clearCancelTimeout();
    disposeWatchdog();
    clearSafetyLimitTimeout();
    engine?.interruptGenerate();
    setState({ status: "error", error });
    logEvent(
      createLogEvent("inference.degenerate-output", "warn", {
        conversationId,
        errorCode: error.code,
        reason,
        responseLength,
      })
    );
    recordLocalLog({
      event: "inference.degenerate-output",
      severity: "warn",
      modelId: localModelId,
      backend: "webgpu",
      runtimeStatus: "error",
      errorCode: toLocalLogErrorCode(error.code),
      performanceMetrics: generationMetrics,
    });

    return { error, metrics };
  }

  async function loadModel(modelId: string = DEFAULT_MODEL_ID, options: LoadModelOptions = {}): Promise<ModelLoadRuntimeMetrics | null> {
    const loadStartedAt = Date.now();
    const localModelId = toLocalLogModelId(modelId);
    const initialStatus = options.initialStatus ?? "loading_model";

    setState({ status: initialStatus, modelId, loadProgress: 0, error: null });
    logEvent(createLogEvent("model.load.started", "info", { modelId }));
    recordLocalLog({ event: "model.load.started", severity: "info", modelId: localModelId, runtimeStatus: initialStatus });

    const webgpuAvailable = await detectWebGPUAvailability();
    if (!webgpuAvailable) {
      const error: RuntimeError = { code: "webgpu_unavailable", message: "WebGPU is not available in this browser." };
      setState({ status: "error", error });
      logEvent(createLogEvent("model.load.failed", "error", { modelId, errorCode: error.code }));
      recordLocalLog({
        event: "model.load.failed",
        severity: "error",
        modelId: localModelId,
        runtimeStatus: "error",
        errorCode: toLocalLogErrorCode(error.code),
      });
      return null;
    }

    try {
      const engineConfig = {
        initProgressCallback: (report: InitProgressReport) => {
          setState({ loadProgress: report.progress });
        },
      };
      engine = options.contextWindowTokens !== undefined
        ? await CreateWebWorkerMLCEngine(worker, modelId, engineConfig, {
            context_window_size: options.contextWindowTokens,
          })
        : await CreateWebWorkerMLCEngine(worker, modelId, engineConfig);
      const loadTimeMs = Date.now() - loadStartedAt;
      setState({ status: "ready", loadProgress: 1 });
      logEvent(createLogEvent("model.load.completed", "info", { modelId }));
      recordLocalLog({
        event: "model.load.completed",
        severity: "info",
        modelId: localModelId,
        backend: "webgpu",
        runtimeStatus: "ready",
        performanceMetrics: { loadTimeMs },
      });
      return { loadTimeMs };
    } catch (rawError) {
      const error = classifyRuntimeError(rawError, "load");
      setState({ status: "error", error });
      logEvent(createLogEvent("model.load.failed", "error", { modelId, errorCode: error.code }));
      recordLocalLog({
        event: "model.load.failed",
        severity: "error",
        modelId: localModelId,
        runtimeStatus: "error",
        errorCode: toLocalLogErrorCode(error.code),
      });
      return null;
    }
  }

  async function* generate(input: GenerateInput): AsyncGenerator<GenerateChunk> {
    if (!engine || state.status !== "ready") {
      yield { type: "error", error: { code: "unknown", message: "Runtime is not ready to generate." } };
      return;
    }

    const myEpoch = ++generationEpoch;
    const localModelId = state.modelId ? toLocalLogModelId(state.modelId) : undefined;

    setState({ status: "generating" });
    logEvent(
      createLogEvent("inference.started", "info", {
        conversationId: input.conversationId,
        promptLength: input.prompt.length,
      })
    );
    recordLocalLog({ event: "inference.started", severity: "info", modelId: localModelId, backend: "webgpu", runtimeStatus: "generating" });

    const generationStartedAt = Date.now();
    let firstTokenAt: number | null = null;
    let tokenCount = 0;

    const watchdog = createGenerationWatchdog({
      generationId: `generation-${myEpoch}`,
      firstTokenTimeoutMs: FIRST_TOKEN_TIMEOUT_MS,
      stallTimeoutMs: STALL_TIMEOUT_MS,
      onFirstTokenTimeout: () => {
        forceRecovery(
          myEpoch,
          {
            code: "generation_stalled",
            message: "The local model didn't respond in time. Try reloading it.",
          },
          "inference.first-token-timeout",
          localModelId
        );
      },
      onStallTimeout: () => {
        forceRecovery(
          myEpoch,
          {
            code: "generation_stalled",
            message: "The local model stopped responding. Try reloading it.",
          },
          "inference.stall-timeout",
          localModelId
        );
      },
    });
    currentWatchdog = watchdog;
    if (watchdogSuspended) watchdog.suspend();

    // A wholly separate, much larger emergency cap — see
    // ABSOLUTE_GENERATION_SAFETY_LIMIT_MS above. Unlike the watchdog, this
    // is a flat wall-clock timer: it is not reset by progress, because its
    // entire purpose is bounding total duration regardless of activity.
    safetyLimitTimeoutHandle = setTimeout(() => {
      safetyLimitTimeoutHandle = null;
      forceRecovery(
        myEpoch,
        {
          code: "generation_exceeded_safety_limit",
          message: "Generation exceeded the maximum allowed duration and was stopped.",
        },
        "inference.generation-safety-limit",
        localModelId
      );
    }, ABSOLUTE_GENERATION_SAFETY_LIMIT_MS);

    try {
      const stream = await engine.chat.completions.create({
        messages: [
          { role: "system", content: getRuntimeLanguageInstruction(input.responseLocale) },
          { role: "user", content: input.prompt },
        ],
        stream: true,
        // Opts into WebLLM's dedicated usage trailer chunk (see this file's
        // top-of-file WebLLM API note) -- without this, `chunk.usage` is
        // never populated at all, on any chunk.
        stream_options: { include_usage: true },
        // The router-recommended budget is a ceiling, never an increase: it
        // can only tighten the existing alpha safety cap, not raise it.
        max_tokens:
          input.maxOutputTokens !== undefined
            ? Math.min(input.maxOutputTokens, GENERATION_SAFETY_LIMITS.maxTokens)
            : GENERATION_SAFETY_LIMITS.maxTokens,
      });

      let responseLength = 0;
      let cancelled = false;
      // Captures WebLLM's own finish_reason from whichever chunk carries it
      // (normally only the final one) for mapFinishReason() above to
      // classify exhaustively once the stream ends. Stays null if no chunk
      // ever carries one at all - that is itself a real, distinct outcome
      // ("unknown_terminal"), not treated as a proxy for "stop".
      let finishReason: ChatCompletionFinishReason | null = null;
      let outputForSafety = "";
      // Captured independently of `chunk.choices[0]`: WebLLM's usage
      // trailer chunk has `choices: []` (see this file's top-of-file note),
      // so this is checked on every chunk regardless of whether it also
      // carries content/finish_reason. Stays undefined on any interrupted
      // path (degenerate output, abort, stall/error) -- those never
      // continue iterating far enough to reach it.
      let capturedUsage: CompletionUsage | undefined;

      for await (const chunk of stream) {
        if (myEpoch !== generationEpoch) {
          const forcedError = takeForcedRecoveryError(myEpoch);
          if (forcedError) yield { type: "error", error: forcedError };
          return;
        }

        if (chunk.usage) capturedUsage = chunk.usage;

        const choice = chunk.choices[0];
        const text = choice?.delta?.content ?? "";
        if (text) {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          // The watchdog heartbeat, updated straight from this raw worker
          // chunk — never gated on UI buffering/rendering (see
          // apps/web/app/_lib/streamingBuffer.ts, which flushes text to
          // React on its own schedule downstream of this yield).
          watchdog.recordProgress();
          tokenCount += 1;
          const nextOutput = outputForSafety + text;
          const degenerate = detectDegenerateOutput(nextOutput);
          if (degenerate.detected && degenerate.reason) {
            responseLength = nextOutput.length;
            const { metrics } = recoverFromDegenerateOutput(
              myEpoch,
              degenerate.reason,
              generationStartedAt,
              firstTokenAt,
              tokenCount,
              responseLength,
              localModelId,
              input.conversationId
            );
            yield { type: "done", reason: "degenerate_output", metrics };
            return;
          }

          outputForSafety = nextOutput;
          responseLength = outputForSafety.length;
          yield { type: "token", text };
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
          if (finishReason === "abort") {
            cancelled = true;
            break;
          }
        }
      }

      // A cancel confirmation or a watchdog/safety-limit timeout already
      // force-resolved this generation while we were waiting on the stream;
      // don't overwrite the recovered state with this late confirmation.
      if (myEpoch !== generationEpoch) {
        const forcedError = takeForcedRecoveryError(myEpoch);
        if (forcedError) yield { type: "error", error: forcedError };
        return;
      }
      clearCancelTimeout();
      disposeWatchdog();
      clearSafetyLimitTimeout();

      const { firstTokenMs, tokensPerSecond, totalTimeMs } = buildGenerationMetrics(generationStartedAt, firstTokenAt, tokenCount);
      // `capturedUsage` is only ever non-undefined here on a clean stream
      // end (see this loop's own comment): an abort break above always
      // leaves it undefined, so a cancelled-via-stream outcome always
      // reports "unavailable" usage, honestly.
      const metrics = buildDoneMetrics(generationStartedAt, firstTokenAt, firstTokenMs, totalTimeMs, capturedUsage);
      const usage = metrics.usage;

      // Every terminal outcome is classified explicitly by mapFinishReason()
      // above - there is no catch-all branch that assumes success. A
      // length-limited, tool-call, or unexplained ("unknown_terminal") stream
      // end is never folded into "completed"; the runtime still returns to
      // "ready" in every one of these cases (WebLLM itself did not error).
      const stopReason: GenerationStopReason = mapFinishReason(finishReason, cancelled);
      const stopEvent = stopEventNameFor(stopReason);

      setState({ status: cancelled ? "cancelling" : "ready" });
      yield { type: "done", reason: stopReason, metrics };
      logEvent(createLogEvent(stopEvent, "info", { conversationId: input.conversationId, responseLength }));
      recordLocalLog({
        event: stopEvent,
        severity: "info",
        modelId: localModelId,
        backend: "webgpu",
        runtimeStatus: cancelled ? "cancelling" : "ready",
        performanceMetrics: {
          firstTokenMs,
          tokensPerSecond,
          totalTimeMs,
          tokenCountConfidence: usage.tokenCountConfidence,
          ...(usage.tokenCountConfidence === "exact"
            ? {
                exactGeneratedTokenCount: usage.completionTokens,
                exactPromptTokenCount: usage.promptTokens,
                exactOverallCompletionTokensPerSecond: usage.overallCompletionTokensPerSecond,
              }
            : {}),
        },
      });
    } catch (rawError) {
      if (myEpoch !== generationEpoch) {
        const forcedError = takeForcedRecoveryError(myEpoch);
        if (forcedError) yield { type: "error", error: forcedError };
        return;
      }
      clearCancelTimeout();
      disposeWatchdog();
      clearSafetyLimitTimeout();

      const error = classifyRuntimeError(rawError, "generate");
      const cancelled = error.code === "generation_interrupted";
      setState({ status: cancelled ? "cancelling" : "ready", error: cancelled ? null : error });
      if (cancelled) {
        // No buildGenerationMetrics() call already happened on this path --
        // one fresh Date.now() read here is the only way to know how long
        // this attempt ran before the exception. The stream never reached a
        // usage trailer chunk (it was interrupted), so usage is always
        // "unavailable".
        const totalTimeMs = Date.now() - generationStartedAt;
        const firstTokenMs = firstTokenAt !== null ? firstTokenAt - generationStartedAt : null;
        const metrics = buildDoneMetrics(generationStartedAt, firstTokenAt, firstTokenMs, totalTimeMs, undefined);
        yield { type: "done", reason: "cancelled", metrics };
      } else {
        yield { type: "error", error };
      }
      logEvent(
        createLogEvent(
          cancelled ? "inference.cancelled" : "inference.failed",
          cancelled ? "info" : "error",
          { conversationId: input.conversationId, errorCode: error.code }
        )
      );
      recordLocalLog({
        event: cancelled ? "inference.cancelled" : "inference.failed",
        severity: cancelled ? "info" : "error",
        modelId: localModelId,
        runtimeStatus: cancelled ? "cancelling" : "ready",
        errorCode: cancelled ? undefined : toLocalLogErrorCode(error.code),
      });
    }
  }

  function stopGeneration(): void {
    if (state.status !== "generating") return;

    const epochAtRequest = generationEpoch;
    const localModelId = state.modelId ? toLocalLogModelId(state.modelId) : undefined;

    // Once the user asks to stop, "did progress ever happen" is no longer
    // the relevant question — only "did the cancellation confirm".
    disposeWatchdog();
    clearSafetyLimitTimeout();

    setState({ status: "cancelling" });
    logEvent(createLogEvent("inference.cancel.requested", "info", {}));
    recordLocalLog({
      event: "inference.cancel.requested",
      severity: "info",
      modelId: localModelId,
      runtimeStatus: "cancelling",
    });

    engine?.interruptGenerate();

    cancelTimeoutHandle = setTimeout(() => {
      cancelTimeoutHandle = null;
      forceRecovery(
        epochAtRequest,
        {
          code: "cancel_timeout",
          message: "Cancellation is taking longer than expected. The local model may be unresponsive.",
        },
        "inference.cancel.timeout",
        localModelId
      );
    }, CANCEL_TIMEOUT_MS);
  }

  async function dispose(): Promise<void> {
    clearCancelTimeout();
    disposeWatchdog();
    clearSafetyLimitTimeout();
    forcedRecoveryErrors.clear();
    generationEpoch += 1;

    try {
      await engine?.unload();
    } catch (rawError) {
      const errorCode = classifyRuntimeError(rawError, "generate").code;
      logEvent(createLogEvent("model.unload.failed", "warn", { errorCode }));
      recordLocalLog({ event: "model.unload.failed", severity: "warn", errorCode: toLocalLogErrorCode(errorCode) });
    } finally {
      engine = null;
      setState(IDLE_STATE);
    }
  }

  function setGenerationWatchdogSuspended(suspended: boolean): void {
    watchdogSuspended = suspended;
    if (suspended) {
      currentWatchdog?.suspend();
    } else {
      currentWatchdog?.resume();
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadModel,
    generate,
    stopGeneration,
    setGenerationWatchdogSuspended,
    dispose,
  };
}

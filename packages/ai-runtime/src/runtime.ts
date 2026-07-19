import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { InitProgressReport, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
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
import type { GenerateChunk, GenerateInput, InferenceChatWorker, RuntimeError, RuntimeState, RuntimeStatus } from "./types";

export interface LoadModelOptions {
  initialStatus?: Extract<RuntimeStatus, "loading_model" | "recovering">;
  contextWindowTokens?: number;
}

export interface InferenceRuntime {
  getState(): RuntimeState;
  subscribe(listener: (state: RuntimeState) => void): () => void;
  loadModel(modelId?: string, options?: LoadModelOptions): Promise<void>;
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

  function buildGenerationMetrics(generationStartedAt: number, firstTokenAt: number | null, tokenCount: number) {
    const totalTimeMs = Date.now() - generationStartedAt;
    const firstTokenMs = firstTokenAt !== null ? firstTokenAt - generationStartedAt : null;
    const tokensPerSecond =
      tokenCount > 0 && totalTimeMs > 0 ? Math.round((tokenCount / (totalTimeMs / 1000)) * 10) / 10 : undefined;

    return { firstTokenMs, tokensPerSecond, totalTimeMs };
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
  ): RuntimeError {
    const error: RuntimeError = {
      code: "degenerate_output",
      message: "Generation stopped because the local model output became unstable.",
    };

    if (expectedEpoch !== generationEpoch) return error;
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
      performanceMetrics: buildGenerationMetrics(generationStartedAt, firstTokenAt, tokenCount),
    });

    return error;
  }

  async function loadModel(modelId: string = DEFAULT_MODEL_ID, options: LoadModelOptions = {}): Promise<void> {
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
      return;
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
        // The router-recommended budget is a ceiling, never an increase: it
        // can only tighten the existing alpha safety cap, not raise it.
        max_tokens:
          input.maxOutputTokens !== undefined
            ? Math.min(input.maxOutputTokens, GENERATION_SAFETY_LIMITS.maxTokens)
            : GENERATION_SAFETY_LIMITS.maxTokens,
      });

      let responseLength = 0;
      let cancelled = false;
      let outputForSafety = "";

      for await (const chunk of stream) {
        if (myEpoch !== generationEpoch) {
          const forcedError = takeForcedRecoveryError(myEpoch);
          if (forcedError) yield { type: "error", error: forcedError };
          return;
        }

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
            recoverFromDegenerateOutput(
              myEpoch,
              degenerate.reason,
              generationStartedAt,
              firstTokenAt,
              tokenCount,
              responseLength,
              localModelId,
              input.conversationId
            );
            yield { type: "done", reason: "degenerate_output" };
            return;
          }

          outputForSafety = nextOutput;
          responseLength = outputForSafety.length;
          yield { type: "token", text };
        }
        if (choice?.finish_reason === "abort") {
          cancelled = true;
          break;
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

      setState({ status: cancelled ? "cancelling" : "ready" });
      yield { type: "done", reason: cancelled ? "cancelled" : "completed" };
      logEvent(
        createLogEvent(
          cancelled ? "inference.cancelled" : "inference.completed",
          "info",
          { conversationId: input.conversationId, responseLength }
        )
      );
      recordLocalLog({
        event: cancelled ? "inference.cancelled" : "inference.completed",
        severity: "info",
        modelId: localModelId,
        backend: "webgpu",
        runtimeStatus: cancelled ? "cancelling" : "ready",
        performanceMetrics: { firstTokenMs, tokensPerSecond, totalTimeMs },
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
      yield cancelled ? { type: "done", reason: "cancelled" } : { type: "error", error };
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

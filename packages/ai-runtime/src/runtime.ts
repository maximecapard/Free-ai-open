import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { InitProgressReport, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { detectWebGPUAvailability } from "@free-ai-open/device-profiler";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { classifyRuntimeError } from "./errors";
import { detectDegenerateOutput, GENERATION_SAFETY_LIMITS } from "./generation-safety";
import { getRuntimeLanguageInstruction } from "./language-instruction";
import { recordLocalLog, toLocalLogErrorCode, toLocalLogModelId } from "./local-log-bridge";
import { DEFAULT_MODEL_ID } from "./model";
import type { DegenerateOutputReason } from "./generation-safety";
import type { GenerateChunk, GenerateInput, InferenceChatWorker, RuntimeError, RuntimeState, RuntimeStatus } from "./types";

export interface LoadModelOptions {
  initialStatus?: Extract<RuntimeStatus, "loading_model" | "recovering">;
}

export interface InferenceRuntime {
  getState(): RuntimeState;
  subscribe(listener: (state: RuntimeState) => void): () => void;
  loadModel(modelId?: string, options?: LoadModelOptions): Promise<void>;
  generate(input: GenerateInput): AsyncGenerator<GenerateChunk>;
  stopGeneration(): void;
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

// A separate, more generous safety net: even without ever clicking Stop, a
// generation can occasionally wedge the underlying worker/engine (observed
// after a prior interrupted generation) and never emit a single token. This
// only fires if literally nothing has streamed back yet, so it never cuts
// off a response that is merely slow but making progress.
const STALL_TIMEOUT_MS = 45_000;
const GENERATION_TIMEOUT_MS = GENERATION_SAFETY_LIMITS.maxDurationMs;

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
  let stallTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let generationTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

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

  function clearStallTimeout(): void {
    if (stallTimeoutHandle !== null) {
      clearTimeout(stallTimeoutHandle);
      stallTimeoutHandle = null;
    }
  }

  function clearGenerationTimeout(): void {
    if (generationTimeoutHandle !== null) {
      clearTimeout(generationTimeoutHandle);
      generationTimeoutHandle = null;
    }
  }

  // Shared by the cancel-confirmation timeout and the stall timeout: forces
  // the runtime into a recoverable error state, but only if nothing has
  // resolved this same generation in the meantime.
  function forceRecovery(expectedEpoch: number, error: RuntimeError, event: string, localModelId: string | undefined): void {
    if (expectedEpoch !== generationEpoch) return;
    generationEpoch += 1;
    clearCancelTimeout();
    clearStallTimeout();
    clearGenerationTimeout();
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
    clearStallTimeout();
    clearGenerationTimeout();
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
      engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (report: InitProgressReport) => {
          setState({ loadProgress: report.progress });
        },
      });
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

    stallTimeoutHandle = setTimeout(() => {
      stallTimeoutHandle = null;
      if (firstTokenAt !== null) return; // already producing output; not stalled
      forceRecovery(
        myEpoch,
        {
          code: "generation_stalled",
          message: "The local model stopped responding. Try reloading it.",
        },
        "inference.stall.timeout",
        localModelId
      );
    }, STALL_TIMEOUT_MS);

    generationTimeoutHandle = setTimeout(() => {
      generationTimeoutHandle = null;
      forceRecovery(
        myEpoch,
        {
          code: "generation_timeout",
          message: "Generation took too long and was stopped. Try reloading the model if this repeats.",
        },
        "inference.generation-timeout",
        localModelId
      );
    }, GENERATION_TIMEOUT_MS);

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
        const choice = chunk.choices[0];
        const text = choice?.delta?.content ?? "";
        if (text) {
          if (firstTokenAt === null) {
            firstTokenAt = Date.now();
            clearStallTimeout();
          }
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

      // A cancel or stall timeout already force-resolved this generation
      // while we were waiting on the stream; don't overwrite the recovered
      // state with this late confirmation.
      if (myEpoch !== generationEpoch) return;
      clearCancelTimeout();
      clearStallTimeout();
      clearGenerationTimeout();

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
      if (myEpoch !== generationEpoch) return;
      clearCancelTimeout();
      clearStallTimeout();
      clearGenerationTimeout();

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

    // Once the user asks to stop, "did a first token ever arrive" is no
    // longer the relevant question — only "did the cancellation confirm".
    clearStallTimeout();
    clearGenerationTimeout();

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
    clearStallTimeout();
    clearGenerationTimeout();
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

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadModel,
    generate,
    stopGeneration,
    dispose,
  };
}

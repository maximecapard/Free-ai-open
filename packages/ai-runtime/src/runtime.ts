import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { InitProgressReport, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { detectWebGPUAvailability } from "@free-ai-open/device-profiler";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { classifyRuntimeError } from "./errors";
import { recordLocalLog, toLocalLogErrorCode, toLocalLogModelId } from "./local-log-bridge";
import { DEFAULT_MODEL_ID } from "./model";
import type { GenerateChunk, GenerateInput, InferenceChatWorker, RuntimeError, RuntimeState } from "./types";

export interface InferenceRuntime {
  getState(): RuntimeState;
  subscribe(listener: (state: RuntimeState) => void): () => void;
  loadModel(modelId?: string): Promise<void>;
  generate(input: GenerateInput): AsyncGenerator<GenerateChunk>;
  stopGeneration(): void;
  dispose(): Promise<void>;
}

const IDLE_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };

// Must only be called from a Client Component, never from a Server Component.
export function createInferenceRuntime(worker: InferenceChatWorker): InferenceRuntime {
  let state: RuntimeState = { ...IDLE_STATE };
  let engine: WebWorkerMLCEngine | null = null;
  const listeners = new Set<(state: RuntimeState) => void>();

  function setState(next: Partial<RuntimeState>): void {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  }

  async function loadModel(modelId: string = DEFAULT_MODEL_ID): Promise<void> {
    const loadStartedAt = Date.now();
    const localModelId = toLocalLogModelId(modelId);

    setState({ status: "loading_model", modelId, loadProgress: 0, error: null });
    logEvent(createLogEvent("model.load.started", "info", { modelId }));
    recordLocalLog({ event: "model.load.started", severity: "info", modelId: localModelId, runtimeStatus: "loading_model" });

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

    try {
      const stream = await engine.chat.completions.create({
        messages: [{ role: "user", content: input.prompt }],
        stream: true,
      });

      let responseLength = 0;
      let cancelled = false;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const text = choice?.delta?.content ?? "";
        if (text) {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          tokenCount += 1;
          responseLength += text.length;
          yield { type: "token", text };
        }
        if (choice?.finish_reason === "abort") {
          cancelled = true;
          break;
        }
      }

      const totalTimeMs = Date.now() - generationStartedAt;
      const firstTokenMs = firstTokenAt !== null ? firstTokenAt - generationStartedAt : null;
      const tokensPerSecond =
        tokenCount > 0 && totalTimeMs > 0 ? Math.round((tokenCount / (totalTimeMs / 1000)) * 10) / 10 : undefined;

      setState({ status: "ready" });
      yield { type: "done" };
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
        runtimeStatus: "ready",
        performanceMetrics: { firstTokenMs, tokensPerSecond, totalTimeMs },
      });
    } catch (rawError) {
      const error = classifyRuntimeError(rawError, "generate");
      const cancelled = error.code === "generation_interrupted";
      setState({ status: "ready", error: cancelled ? null : error });
      yield cancelled ? { type: "done" } : { type: "error", error };
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
        runtimeStatus: "ready",
        errorCode: cancelled ? undefined : toLocalLogErrorCode(error.code),
      });
    }
  }

  function stopGeneration(): void {
    engine?.interruptGenerate();
  }

  async function dispose(): Promise<void> {
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

import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { InitProgressReport, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { detectWebGPUAvailability } from "@free-ai-open/device-profiler";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { classifyRuntimeError } from "./errors";
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
    setState({ status: "loading_model", modelId, loadProgress: 0, error: null });
    logEvent(createLogEvent("model.load.started", "info", { modelId }));

    const webgpuAvailable = await detectWebGPUAvailability();
    if (!webgpuAvailable) {
      const error: RuntimeError = { code: "webgpu_unavailable", message: "WebGPU is not available in this browser." };
      setState({ status: "error", error });
      logEvent(createLogEvent("model.load.failed", "error", { modelId, errorCode: error.code }));
      return;
    }

    try {
      engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (report: InitProgressReport) => {
          setState({ loadProgress: report.progress });
        },
      });
      setState({ status: "ready", loadProgress: 1 });
      logEvent(createLogEvent("model.load.completed", "info", { modelId }));
    } catch (rawError) {
      const error = classifyRuntimeError(rawError, "load");
      setState({ status: "error", error });
      logEvent(createLogEvent("model.load.failed", "error", { modelId, errorCode: error.code }));
    }
  }

  async function* generate(input: GenerateInput): AsyncGenerator<GenerateChunk> {
    if (!engine || state.status !== "ready") {
      yield { type: "error", error: { code: "unknown", message: "Runtime is not ready to generate." } };
      return;
    }

    setState({ status: "generating" });
    logEvent(
      createLogEvent("inference.started", "info", {
        conversationId: input.conversationId,
        promptLength: input.prompt.length,
      })
    );

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
          responseLength += text.length;
          yield { type: "token", text };
        }
        if (choice?.finish_reason === "abort") {
          cancelled = true;
          break;
        }
      }

      setState({ status: "ready" });
      yield { type: "done" };
      logEvent(
        createLogEvent(
          cancelled ? "inference.cancelled" : "inference.completed",
          "info",
          { conversationId: input.conversationId, responseLength }
        )
      );
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
    }
  }

  function stopGeneration(): void {
    engine?.interruptGenerate();
  }

  async function dispose(): Promise<void> {
    try {
      await engine?.unload();
    } catch (rawError) {
      logEvent(createLogEvent("model.unload.failed", "warn", { errorCode: classifyRuntimeError(rawError, "generate").code }));
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

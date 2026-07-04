import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InferenceChatWorker } from "./types";

const mocks = vi.hoisted(() => ({
  detectWebGPUAvailability: vi.fn(),
  logEvent: vi.fn(),
  createLogEvent: vi.fn((event: string, level: string, data?: Record<string, unknown>) => ({
    event,
    level,
    data,
    timestamp: "2026-01-01T00:00:00.000Z",
    contentLogged: false as const,
  })),
  addLocalLog: vi.fn(),
  CreateWebWorkerMLCEngine: vi.fn(),
  mockEngine: {
    chat: { completions: { create: vi.fn() } },
    interruptGenerate: vi.fn(),
    unload: vi.fn(),
  },
}));

vi.mock("@free-ai-open/device-profiler", () => ({
  detectWebGPUAvailability: mocks.detectWebGPUAvailability,
}));

vi.mock("@free-ai-open/logger", () => ({
  logEvent: mocks.logEvent,
  createLogEvent: mocks.createLogEvent,
}));

vi.mock("@free-ai-open/local-logs", () => ({
  addLocalLog: mocks.addLocalLog,
}));

vi.mock("@mlc-ai/web-llm", () => ({
  CreateWebWorkerMLCEngine: mocks.CreateWebWorkerMLCEngine,
}));

const { createInferenceRuntime } = await import("./runtime");

function fakeWorker(): InferenceChatWorker {
  return { postMessage: vi.fn(), onmessage: null };
}

async function drain<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of generator) items.push(item);
  return items;
}

beforeEach(() => {
  mocks.detectWebGPUAvailability.mockReset().mockResolvedValue(true);
  mocks.logEvent.mockReset();
  mocks.createLogEvent.mockClear();
  mocks.addLocalLog.mockReset().mockResolvedValue(null);
  mocks.mockEngine.chat.completions.create.mockReset();
  mocks.mockEngine.interruptGenerate.mockReset();
  mocks.mockEngine.unload.mockReset().mockResolvedValue(undefined);
  mocks.CreateWebWorkerMLCEngine.mockReset().mockImplementation(
    async (_worker: unknown, _modelId: string, config?: { initProgressCallback?: (report: { progress: number }) => void }) => {
      config?.initProgressCallback?.({ progress: 0.5 });
      config?.initProgressCallback?.({ progress: 1 });
      return mocks.mockEngine;
    }
  );
});

describe("createInferenceRuntime", () => {
  it("starts idle", () => {
    const runtime = createInferenceRuntime(fakeWorker());
    expect(runtime.getState()).toEqual({ status: "idle", modelId: null, loadProgress: 0, error: null });
  });

  it("loads a model and becomes ready", async () => {
    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");

    const state = runtime.getState();
    expect(state.status).toBe("ready");
    expect(state.modelId).toBe("test-model");
    expect(state.loadProgress).toBe(1);
    expect(mocks.logEvent).toHaveBeenCalled();
  });

  it("fails to load when WebGPU is unavailable, without touching the engine", async () => {
    mocks.detectWebGPUAvailability.mockResolvedValue(false);
    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");

    const state = runtime.getState();
    expect(state.status).toBe("error");
    expect(state.error?.code).toBe("webgpu_unavailable");
    expect(mocks.CreateWebWorkerMLCEngine).not.toHaveBeenCalled();
  });

  it("classifies an unsupported-model load failure", async () => {
    mocks.CreateWebWorkerMLCEngine.mockRejectedValueOnce(new Error("model not found in appConfig"));
    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("missing-model");

    const state = runtime.getState();
    expect(state.status).toBe("error");
    expect(state.error?.code).toBe("model_unsupported");
  });

  it("refuses to generate before the model is ready", async () => {
    const runtime = createInferenceRuntime(fakeWorker());
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(chunks).toEqual([
      { type: "error", error: { code: "unknown", message: "Runtime is not ready to generate." } },
    ]);
  });

  it("streams tokens and returns to ready when generation completes", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
        yield { choices: [{ delta: { content: "lo" }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: "stop" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(chunks).toEqual([
      { type: "token", text: "Hel" },
      { type: "token", text: "lo" },
      { type: "done" },
    ]);
    expect(runtime.getState().status).toBe("ready");
  });

  it("treats an aborted stream as a clean cancellation, not an error", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Par" }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: "abort" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(chunks).toEqual([{ type: "token", text: "Par" }, { type: "done" }]);
    expect(runtime.getState().status).toBe("ready");
    expect(runtime.getState().error).toBeNull();
  });

  it("surfaces a generation failure without leaking prompt content anywhere", async () => {
    mocks.mockEngine.chat.completions.create.mockRejectedValue(new Error("device lost, out of memory"));

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "super secret prompt" }));

    expect(chunks).toEqual([
      { type: "error", error: { code: "out_of_memory", message: "device lost, out of memory" } },
    ]);

    for (const call of mocks.createLogEvent.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("super secret prompt");
    }
  });

  it("stopGeneration calls interruptGenerate on the engine", async () => {
    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    runtime.stopGeneration();

    expect(mocks.mockEngine.interruptGenerate).toHaveBeenCalledTimes(1);
  });

  it("dispose unloads the engine and resets to idle", async () => {
    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    await runtime.dispose();

    expect(mocks.mockEngine.unload).toHaveBeenCalledTimes(1);
    expect(runtime.getState()).toEqual({ status: "idle", modelId: null, loadProgress: 0, error: null });
  });

  it("dispose resolves and still resets to idle even when engine.unload() rejects", async () => {
    mocks.mockEngine.unload.mockRejectedValueOnce(new Error("device already lost"));
    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");

    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(runtime.getState()).toEqual({ status: "idle", modelId: null, loadProgress: 0, error: null });
  });

  it("logs a technical, content-free warning when dispose fails to unload", async () => {
    mocks.mockEngine.unload.mockRejectedValueOnce(new Error("device already lost"));
    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    mocks.createLogEvent.mockClear();

    await runtime.dispose();

    expect(mocks.createLogEvent).toHaveBeenCalledWith(
      "model.unload.failed",
      "warn",
      expect.objectContaining({ errorCode: expect.any(String) })
    );
  });

  describe("local-logs persistence", () => {
    it("lowercases mixed-case model IDs before persisting (local-logs rejects uppercase modelId)", async () => {
      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("SmolLM2-135M-Instruct-q0f32-MLC");

      expect(mocks.addLocalLog).toHaveBeenCalledWith(
        expect.objectContaining({ event: "model.load.started", modelId: "smollm2-135m-instruct-q0f32-mlc" })
      );
      expect(mocks.addLocalLog).toHaveBeenCalledWith(
        expect.objectContaining({ event: "model.load.completed", modelId: "smollm2-135m-instruct-q0f32-mlc" })
      );
    });

    it("uppercases the errorCode before persisting (local-logs rejects lowercase-with-underscore codes)", async () => {
      mocks.detectWebGPUAvailability.mockResolvedValue(false);
      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      expect(mocks.addLocalLog).toHaveBeenCalledWith(
        expect.objectContaining({ event: "model.load.failed", errorCode: "WEBGPU_UNAVAILABLE" })
      );
    });

    it("records loadTimeMs on successful model load", async () => {
      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      expect(mocks.addLocalLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "model.load.completed",
          performanceMetrics: expect.objectContaining({ loadTimeMs: expect.any(Number) }),
        })
      );
    });

    it("records firstTokenMs and tokensPerSecond on completed generation", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValue(
        (async function* () {
          yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
          yield { choices: [{ delta: { content: "lo" }, finish_reason: null }] };
          yield { choices: [{ delta: {}, finish_reason: "stop" }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      // Date.now() is mocked only for the generate() call, so timings are
      // deterministic instead of racing real elapsed time (which can be
      // 0ms in a fast test run). generate() calls Date.now() exactly 3
      // times: generationStartedAt, firstTokenAt, and the final totalTimeMs.
      const timestamps = [0, 100, 2000];
      vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 2000);

      await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

      expect(mocks.addLocalLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "inference.completed",
          performanceMetrics: { firstTokenMs: 100, tokensPerSecond: 1, totalTimeMs: 2000 },
        })
      );

      vi.restoreAllMocks();
    });

    it("never persists prompt or response content", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValue(
        (async function* () {
          yield { choices: [{ delta: { content: "super secret reply" }, finish_reason: "stop" }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");
      await drain(runtime.generate({ conversationId: "c1", prompt: "super secret prompt" }));

      for (const call of mocks.addLocalLog.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("super secret");
      }
    });
  });
});

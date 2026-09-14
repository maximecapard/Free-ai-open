import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateChunk, InferenceChatWorker } from "./types";

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
const { GENERATION_SAFETY_LIMITS } = await import("./generation-safety");
const { getRuntimeLanguageInstruction } = await import("./language-instruction");

function fakeWorker(): InferenceChatWorker {
  return { postMessage: vi.fn(), onmessage: null };
}

async function drain<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of generator) items.push(item);
  return items;
}

// Most of this file's existing assertions are about finish-reason
// classification (completed/length/cancelled/etc.), not about the exact
// shape of GenerationRuntimeMetrics -- which now rides along on every
// "done" chunk (see generate()'s own doc comments). Rather than hardcoding
// a metrics object into every one of those assertions (which would make
// them fragile to any future metrics field addition and obscure what each
// test is actually about), this strips `metrics` before comparing so those
// tests keep asserting only what they always asserted. Tests that DO care
// about metrics content assert `chunk.metrics` directly instead.
function omitMetrics(chunk: GenerateChunk | undefined): unknown {
  if (!chunk) return chunk;
  return chunk.type === "done" ? { type: chunk.type, reason: chunk.reason } : chunk;
}

function omitAllMetrics(chunks: readonly GenerateChunk[]): unknown[] {
  return chunks.map((chunk) => omitMetrics(chunk));
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

  it("applies a router-selected context window while loading the model", async () => {
    const worker = fakeWorker();
    const runtime = createInferenceRuntime(worker);
    await runtime.loadModel("test-model", { contextWindowTokens: 2048 });

    expect(mocks.CreateWebWorkerMLCEngine).toHaveBeenCalledWith(
      worker,
      "test-model",
      expect.objectContaining({ initProgressCallback: expect.any(Function) }),
      { context_window_size: 2048 }
    );
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

    expect(omitAllMetrics(chunks)).toEqual([
      { type: "token", text: "Hel" },
      { type: "token", text: "lo" },
      { type: "done", reason: "completed" },
    ]);
    expect(runtime.getState().status).toBe("ready");
  });

  it("preserves the natural stop reason distinctly from a length-limited one", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Hi" }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: "stop" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(omitMetrics(chunks.at(-1))).toEqual({ type: "done", reason: "completed" });
    expect(mocks.addLocalLog).toHaveBeenCalledWith(expect.objectContaining({ event: "inference.completed" }));
    expect(mocks.addLocalLog).not.toHaveBeenCalledWith(expect.objectContaining({ event: "inference.length-limited" }));
  });

  it("classifies a WebLLM finish_reason of length as its own distinct stop reason, not a completed success", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Partial reasoning" }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: "length" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(omitAllMetrics(chunks)).toEqual([
      { type: "token", text: "Partial reasoning" },
      { type: "done", reason: "length" },
    ]);
    // The runtime is not in an error state: WebLLM did not fail, it simply
    // reached its configured budget. Status returns to "ready" exactly like
    // a natural completion.
    expect(runtime.getState().status).toBe("ready");
    expect(runtime.getState().error).toBeNull();
    expect(mocks.addLocalLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "inference.length-limited", runtimeStatus: "ready" })
    );
    expect(mocks.addLocalLog).not.toHaveBeenCalledWith(expect.objectContaining({ event: "inference.completed" }));
  });

  it("regression: a long reasoning block that reaches the configured output limit before </think> is reported as length, not completed", async () => {
    // Mirrors a real generation report: qwen3-4b-q4f16, ~162s at ~3.1
    // tokens/s, persisted assistant output ending abruptly inside an
    // unclosed <think> block with no final answer, and finish_reason:
    // "length" from WebLLM once max_tokens was reached.
    const reasoningWords = Array.from({ length: 40 }, (_, i) => `reasoning-token-${i}`);
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "<think>\n" }, finish_reason: null }] };
        for (const word of reasoningWords) {
          yield { choices: [{ delta: { content: `${word} ` }, finish_reason: null }] };
        }
        yield { choices: [{ delta: {}, finish_reason: "length" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "tu peux me faire un exemple..." }));

    const doneChunk = chunks.at(-1);
    expect(omitMetrics(doneChunk)).toEqual({ type: "done", reason: "length" });
    const streamedText = chunks
      .filter((chunk): chunk is { type: "token"; text: string } => chunk.type === "token")
      .map((chunk) => chunk.text)
      .join("");
    expect(streamedText.startsWith("<think>\n")).toBe(true);
    expect(streamedText).not.toContain("</think>");
    expect(runtime.getState().status).toBe("ready");
  });

  it("classifies a WebLLM finish_reason of tool_calls as unsupported, never as a completed success or a runtime failure", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Let me use a tool" }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: "tool_calls" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(omitMetrics(chunks.at(-1))).toEqual({ type: "done", reason: "unsupported_tool_call" });
    // Not an error state: FreeAI Open simply does not support this response
    // shape yet. It is a distinct, explicit incomplete outcome, never
    // scored as model instability (see performanceObservationBuilder.ts).
    expect(runtime.getState().status).toBe("ready");
    expect(runtime.getState().error).toBeNull();
    expect(mocks.addLocalLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "inference.unsupported-tool-call", runtimeStatus: "ready" })
    );
  });

  it("fails closed as unknown_terminal when the stream ends without any chunk ever carrying a finish_reason", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
        yield { choices: [{ delta: { content: "lo" }, finish_reason: null }] };
        // Stream simply ends - no "stop"/"length"/"tool_calls"/"abort" chunk
        // ever arrives. This must never be assumed to be a natural stop.
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(omitMetrics(chunks.at(-1))).toEqual({ type: "done", reason: "unknown_terminal" });
    expect(runtime.getState().status).toBe("ready");
    expect(mocks.addLocalLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "inference.unknown-terminal" })
    );
    expect(mocks.addLocalLog).not.toHaveBeenCalledWith(expect.objectContaining({ event: "inference.completed" }));
  });

  it("fails closed as unknown_terminal for a finish_reason WebLLM's own type does not document, instead of assuming success", async () => {
    // Simulates WebLLM's actual runtime value not matching its declared
    // type - the one case an exhaustive compile-time switch cannot cover by
    // itself. A deliberate unsafe cast is the only way to construct this at
    // the type level; mapFinishReason() must still fail closed at runtime.
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Hi" }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: "some_future_reason" as never }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(omitMetrics(chunks.at(-1))).toEqual({ type: "done", reason: "unknown_terminal" });
    expect(omitMetrics(chunks.at(-1))).not.toEqual({ type: "done", reason: "completed" });
    expect(runtime.getState().status).toBe("ready");
  });

  it("passes a bounded max token limit to WebLLM generation", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

    expect(mocks.mockEngine.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: GENERATION_SAFETY_LIMITS.maxTokens })
    );
  });

  it("tightens the token limit when a smaller router-recommended budget is supplied", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    await drain(runtime.generate({ conversationId: "c1", prompt: "hi", maxOutputTokens: 256 }));

    expect(mocks.mockEngine.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 256 })
    );
  });

  it("never lets a router-recommended budget exceed the alpha safety cap", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    await drain(runtime.generate({ conversationId: "c1", prompt: "hi", maxOutputTokens: GENERATION_SAFETY_LIMITS.maxTokens + 5_000 }));

    expect(mocks.mockEngine.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: GENERATION_SAFETY_LIMITS.maxTokens })
    );
  });

  it("passes the hidden French language instruction to WebLLM without logging it", async () => {
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "Bonjour" }, finish_reason: "stop" }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    await drain(runtime.generate({ conversationId: "c1", prompt: "réponds", responseLocale: "fr" }));

    expect(mocks.mockEngine.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: getRuntimeLanguageInstruction("fr") },
          { role: "user", content: "réponds" },
        ],
      })
    );

    const serializedLogs = JSON.stringify([...mocks.createLogEvent.mock.calls, ...mocks.addLocalLog.mock.calls]);
    expect(serializedLogs).not.toContain(getRuntimeLanguageInstruction("fr"));
    expect(serializedLogs).not.toContain("réponds");
  });

  it("uses English by default and applies locale changes to subsequent generations", async () => {
    mocks.mockEngine.chat.completions.create
      .mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] };
        })()
      )
      .mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Bonjour" }, finish_reason: "stop" }] };
        })()
      );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    await drain(runtime.generate({ conversationId: "c1", prompt: "hi", responseLocale: "en" }));
    await drain(runtime.generate({ conversationId: "c1", prompt: "salut", responseLocale: "fr" }));

    expect(mocks.mockEngine.chat.completions.create.mock.calls[0]?.[0].messages[0]).toEqual({
      role: "system",
      content: getRuntimeLanguageInstruction("en"),
    });
    expect(mocks.mockEngine.chat.completions.create.mock.calls[1]?.[0].messages[0]).toEqual({
      role: "system",
      content: getRuntimeLanguageInstruction("fr"),
    });
  });

  it("stops degenerate output without logging prompt or generated content", async () => {
    const unstableOutput = "<>".repeat(GENERATION_SAFETY_LIMITS.maxRepeatedSymbolBlockRun + 1);
    mocks.mockEngine.chat.completions.create.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: unstableOutput }, finish_reason: null }] };
      })()
    );

    const runtime = createInferenceRuntime(fakeWorker());
    await runtime.loadModel("test-model");
    const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "super secret prompt" }));

    expect(omitAllMetrics(chunks)).toEqual([{ type: "done", reason: "degenerate_output" }]);
    expect(runtime.getState().status).toBe("error");
    expect(runtime.getState().error?.code).toBe("degenerate_output");
    expect(mocks.mockEngine.interruptGenerate).toHaveBeenCalledTimes(1);
    expect(mocks.addLocalLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "inference.degenerate-output",
        runtimeStatus: "error",
        errorCode: "DEGENERATE_OUTPUT",
      })
    );

    for (const call of [...mocks.createLogEvent.mock.calls, ...mocks.addLocalLog.mock.calls]) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("super secret prompt");
      expect(serialized).not.toContain(unstableOutput);
    }
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

    expect(omitAllMetrics(chunks)).toEqual([{ type: "token", text: "Par" }, { type: "done", reason: "cancelled" }]);
    expect(runtime.getState().status).toBe("cancelling");
    expect(runtime.getState().error).toBeNull();
  });

  it("uses the recovering status while loading a replacement runtime", async () => {
    const runtime = createInferenceRuntime(fakeWorker());
    const states: string[] = [];
    runtime.subscribe((state) => states.push(state.status));

    await runtime.loadModel("test-model", { initialStatus: "recovering" });

    expect(states).toContain("recovering");
    expect(runtime.getState().status).toBe("ready");
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

  describe("stopGeneration", () => {
    async function startHangingGeneration(runtime: ReturnType<typeof createInferenceRuntime>) {
      mocks.mockEngine.chat.completions.create.mockResolvedValue(
        (async function* () {
          yield { choices: [{ delta: { content: "Par" }, finish_reason: null }] };
          await new Promise(() => {}); // never resolves: simulates a stalled decode loop
        })()
      );
      await runtime.loadModel("test-model");
      const chunks: unknown[] = [];
      const consume = (async () => {
        for await (const chunk of runtime.generate({ conversationId: "c1", prompt: "hi" })) {
          chunks.push(chunk);
        }
      })();
      await Promise.resolve();
      await Promise.resolve();
      return { chunks, consume };
    }

    it("is a no-op when the runtime isn't generating", async () => {
      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      runtime.stopGeneration();

      expect(mocks.mockEngine.interruptGenerate).not.toHaveBeenCalled();
      expect(runtime.getState().status).toBe("ready");
    });

    it("moves the runtime from generating to cancelling and requests a real interrupt", async () => {
      const runtime = createInferenceRuntime(fakeWorker());
      await startHangingGeneration(runtime);
      expect(runtime.getState().status).toBe("generating");

      runtime.stopGeneration();

      expect(runtime.getState().status).toBe("cancelling");
      expect(mocks.mockEngine.interruptGenerate).toHaveBeenCalledTimes(1);
    });

    it("ignores repeated Stop clicks while cancellation is already in progress", async () => {
      const runtime = createInferenceRuntime(fakeWorker());
      await startHangingGeneration(runtime);

      runtime.stopGeneration();
      runtime.stopGeneration();

      expect(runtime.getState().status).toBe("cancelling");
      expect(mocks.mockEngine.interruptGenerate).toHaveBeenCalledTimes(1);
      expect(
        mocks.addLocalLog.mock.calls.filter((call) => call[0]?.event === "inference.cancel.requested")
      ).toHaveLength(1);
    });

    it("logs inference.cancel.requested immediately, without any prompt content", async () => {
      const runtime = createInferenceRuntime(fakeWorker());
      await startHangingGeneration(runtime);

      runtime.stopGeneration();

      expect(mocks.addLocalLog).toHaveBeenCalledWith(
        expect.objectContaining({ event: "inference.cancel.requested", runtimeStatus: "cancelling" })
      );
      for (const call of [...mocks.createLogEvent.mock.calls, ...mocks.addLocalLog.mock.calls]) {
        expect(JSON.stringify(call)).not.toContain("hi");
      }
    });

    it("blocks a new message while cancelling", async () => {
      const runtime = createInferenceRuntime(fakeWorker());
      await startHangingGeneration(runtime);
      runtime.stopGeneration();
      expect(runtime.getState().status).toBe("cancelling");

      const chunks = await drain(runtime.generate({ conversationId: "c2", prompt: "another message" }));

      expect(chunks).toEqual([
        { type: "error", error: { code: "unknown", message: "Runtime is not ready to generate." } },
      ]);
    });

    it("keeps the interrupted runtime in cancelling after confirmation until the app recycles it", async () => {
      let resolveAbort: (() => void) | undefined;
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Par" }, finish_reason: null }] };
          await new Promise<void>((resolve) => {
            resolveAbort = resolve;
          });
          yield { choices: [{ delta: {}, finish_reason: "abort" }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");
      const firstGeneration = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
      // Wait for the stalled stream to actually reach its internal await
      // point (a few chained async-generator hops past the first yielded
      // token), rather than assuming a fixed number of microtask ticks.
      while (!resolveAbort) {
        await Promise.resolve();
      }

      runtime.stopGeneration();
      expect(runtime.getState().status).toBe("cancelling");

      resolveAbort();
      await firstGeneration;
      expect(runtime.getState().status).toBe("cancelling");
      expect(mocks.addLocalLog).toHaveBeenCalledWith(expect.objectContaining({ event: "inference.cancelled" }));

      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] };
        })()
      );
      const secondGeneration = await drain(runtime.generate({ conversationId: "c3", prompt: "new message" }));

      expect(secondGeneration).toEqual([
        { type: "error", error: { code: "unknown", message: "Runtime is not ready to generate." } },
      ]);
      expect(runtime.getState().status).toBe("cancelling");
    });

    it("allows a replacement runtime to generate after the interrupted runtime is abandoned", async () => {
      let resolveAbort: (() => void) | undefined;
      mocks.mockEngine.chat.completions.create
        .mockResolvedValueOnce(
          (async function* () {
            yield { choices: [{ delta: { content: "Par" }, finish_reason: null }] };
            await new Promise<void>((resolve) => {
              resolveAbort = resolve;
            });
            yield { choices: [{ delta: {}, finish_reason: "abort" }] };
          })()
        )
        .mockResolvedValueOnce(
          (async function* () {
            yield { choices: [{ delta: { content: "Recovered" }, finish_reason: "stop" }] };
          })()
        );

      const interruptedRuntime = createInferenceRuntime(fakeWorker());
      await interruptedRuntime.loadModel("test-model");
      const firstGeneration = drain(interruptedRuntime.generate({ conversationId: "c1", prompt: "hi" }));
      while (!resolveAbort) {
        await Promise.resolve();
      }

      interruptedRuntime.stopGeneration();
      resolveAbort();
      await firstGeneration;
      expect(interruptedRuntime.getState().status).toBe("cancelling");

      const recoveredRuntime = createInferenceRuntime(fakeWorker());
      await recoveredRuntime.loadModel("test-model", { initialStatus: "recovering" });
      const chunks = await drain(recoveredRuntime.generate({ conversationId: "c2", prompt: "next" }));

      expect(omitAllMetrics(chunks)).toEqual([{ type: "token", text: "Recovered" }, { type: "done", reason: "completed" }]);
      expect(recoveredRuntime.getState().status).toBe("ready");
      expect(mocks.CreateWebWorkerMLCEngine).toHaveBeenCalledTimes(2);
    });

    it("recovers via a timeout when cancellation is never confirmed, without falsely logging inference.cancelled", async () => {
      let releaseStalledChunk: (() => void) | undefined;
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Par" }, finish_reason: null }] };
          await new Promise<void>((resolve) => {
            releaseStalledChunk = resolve;
          });
          yield { choices: [{ delta: {}, finish_reason: "abort" }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();
        await Promise.resolve();

        runtime.stopGeneration();
        expect(runtime.getState().status).toBe("cancelling");

        await vi.advanceTimersByTimeAsync(15_000);

        expect(runtime.getState().status).toBe("error");
        expect(runtime.getState().error?.code).toBe("cancel_timeout");
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(expect.objectContaining({ event: "inference.cancelled" }));
        expect(mocks.addLocalLog).toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.cancel.timeout", errorCode: "CANCEL_TIMEOUT" })
        );

        // The stalled stream now "arrives late" with its abort confirmation.
        releaseStalledChunk?.();
        const chunks = await consume;

        // The late confirmation must not overwrite the already-recovered state.
        expect(runtime.getState().status).toBe("error");
        expect(runtime.getState().error?.code).toBe("cancel_timeout");
        expect(chunks).toEqual([
          { type: "token", text: "Par" },
          {
            type: "error",
            error: {
              code: "cancel_timeout",
              message: "Cancellation is taking longer than expected. The local model may be unresponsive.",
            },
          },
        ]);
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(expect.objectContaining({ event: "inference.cancelled" }));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("generation stall recovery", () => {
    function delay(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("recovers when a generation never produces a single token, without a Stop click", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(new Promise(() => {})); // never resolves

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();
        expect(runtime.getState().status).toBe("generating");

        await vi.advanceTimersByTimeAsync(45_000);

        expect(runtime.getState().status).toBe("error");
        expect(runtime.getState().error?.code).toBe("generation_stalled");
        expect(mocks.addLocalLog).toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.first-token-timeout", errorCode: "GENERATION_STALLED" })
        );

        // create() itself never resolves in this scenario, so generate()
        // stays permanently suspended there; matches production, where the
        // abandoned call is simply left running and its outcome ignored.
        void consume;
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not fire once a first token has already streamed (first-token timeout is cleared)", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
          await new Promise(() => {}); // stalls after the first token
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Advance to just under the re-armed stall threshold (measured from
        // the first token, not from generation start): the first-token
        // timeout must never fire once real progress has been recorded.
        await vi.advanceTimersByTimeAsync(44_000);

        expect(runtime.getState().status).toBe("generating");
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.first-token-timeout" })
        );
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(expect.objectContaining({ event: "inference.stall-timeout" }));

        void consume;
      } finally {
        vi.useRealTimers();
      }
    });

    it("declares a genuine stall when no new chunk arrives for the stall threshold after the first token", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
          await new Promise(() => {}); // stalls after the first token, forever
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(45_000);

        expect(runtime.getState().status).toBe("error");
        expect(runtime.getState().error?.code).toBe("generation_stalled");
        expect(mocks.addLocalLog).toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.stall-timeout", errorCode: "GENERATION_STALLED" })
        );

        void consume;
      } finally {
        vi.useRealTimers();
      }
    });

    it("drops a non-empty worker chunk that arrives after stall recovery and emits the forced error", async () => {
      let releaseLateChunk: (() => void) | undefined;
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
          await new Promise<void>((resolve) => {
            releaseLateChunk = resolve;
          });
          yield { choices: [{ delta: { content: "late-content" }, finish_reason: null }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(45_000);
        expect(runtime.getState().error?.code).toBe("generation_stalled");

        releaseLateChunk?.();
        const chunks = await consume;

        expect(chunks).toEqual([
          { type: "token", text: "Hel" },
          {
            type: "error",
            error: {
              code: "generation_stalled",
              message: "The local model stopped responding. Try reloading it.",
            },
          },
        ]);
        expect(chunks).not.toContainEqual({ type: "token", text: "late-content" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("completes successfully when chunks keep streaming continuously past the old absolute-duration threshold (regression)", async () => {
      // Reproduces the reported false timeout: the old implementation armed
      // a single absolute timer at GENERATION_SAFETY_LIMITS.maxDurationMs
      // (90s) from generation start and never reset it on progress, so any
      // healthy generation running longer than that — even while actively
      // streaming — was force-cancelled with a false "generation_timeout".
      // Five chunks spaced 20s apart (well under the 45s stall threshold
      // between any two of them) take 100s in total, comfortably past the
      // old 90s absolute cutoff. Against the old code this test fails with
      // status "error" / error.code "generation_timeout" instead of
      // completing; against the fixed watchdog it must complete normally.
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          for (let index = 0; index < 5; index += 1) {
            await delay(20_000);
            yield { choices: [{ delta: { content: `chunk${index} ` }, finish_reason: null }] };
          }
          yield { choices: [{ delta: {}, finish_reason: "stop" }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const chunks: GenerateChunk[] = [];
        const consume = (async () => {
          for await (const chunk of runtime.generate({ conversationId: "c1", prompt: "hi" })) {
            chunks.push(chunk);
          }
        })();

        await vi.advanceTimersByTimeAsync(105_000);
        await consume;

        expect(runtime.getState().status).toBe("ready");
        expect(runtime.getState().error).toBeNull();
        expect(chunks.filter((chunk) => chunk.type === "token")).toHaveLength(5);
        expect(omitMetrics(chunks.at(-1))).toEqual({ type: "done", reason: "completed" });
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.stall-timeout" })
        );
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.first-token-timeout" })
        );
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.generation-safety-limit" })
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not trigger a timeout when a downstream UI buffer flushes far slower than raw chunks arrive", async () => {
      // Mirrors apps/web/app/_lib/streamingBuffer.ts's append/periodic-flush
      // shape without importing across the package boundary (ai-runtime
      // must stay platform-independent). The point: the consumer batches
      // text into a UI flush every 5 minutes — far slower than the 20s chunk
      // cadence — while the watchdog only ever observes raw chunks the
      // instant generate() yields them, never the buffer's flush timing.
      let pendingUiText = "";
      let uiFlushCount = 0;
      const uiFlushIntervalMs = 300_000;
      let uiFlushHandle: ReturnType<typeof setTimeout> | null = null;
      function appendToUiBuffer(text: string): void {
        pendingUiText += text;
        if (uiFlushHandle !== null) return;
        uiFlushHandle = setTimeout(() => {
          uiFlushHandle = null;
          uiFlushCount += 1;
          pendingUiText = "";
        }, uiFlushIntervalMs);
      }

      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          for (let index = 0; index < 5; index += 1) {
            await delay(20_000);
            yield { choices: [{ delta: { content: `chunk${index} ` }, finish_reason: null }] };
          }
          yield { choices: [{ delta: {}, finish_reason: "stop" }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = (async () => {
          for await (const chunk of runtime.generate({ conversationId: "c1", prompt: "hi" })) {
            if (chunk.type === "token") appendToUiBuffer(chunk.text);
          }
        })();

        await vi.advanceTimersByTimeAsync(105_000);
        await consume;

        expect(runtime.getState().status).toBe("ready");
        expect(runtime.getState().error).toBeNull();
        // The UI buffer genuinely never flushed during the 105s test window
        // (its 300s interval never elapsed) — proving the completion above
        // did not depend on it flushing.
        expect(uiFlushCount).toBe(0);
        expect(pendingUiText.length).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("treats whitespace-only chunks as valid progress", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
          await delay(44_000);
          yield { choices: [{ delta: { content: "   " }, finish_reason: null }] };
          await delay(44_000);
          yield { choices: [{ delta: {}, finish_reason: "stop" }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await vi.advanceTimersByTimeAsync(90_000);
        const chunks = await consume;

        expect(omitMetrics(chunks.at(-1))).toEqual({ type: "done", reason: "completed" });
        expect(runtime.getState().status).toBe("ready");
      } finally {
        vi.useRealTimers();
      }
    });

    it("recovers via the absolute safety limit only for a truly pathological runaway generation, using a distinct error code", async () => {
      // The safety limit is a flat wall-clock cap, unlike the stall
      // watchdog: it is not reset by progress. Simulate an unrealistic
      // stream that keeps producing chunks every 10s (comfortably under the
      // stall threshold) forever, to isolate the emergency cap from the
      // stall/first-token watchdog above it.
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          while (true) {
            await delay(10_000);
            yield { choices: [{ delta: { content: "x" }, finish_reason: null }] };
          }
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(600_000);

        expect(runtime.getState().status).toBe("error");
        expect(runtime.getState().error?.code).toBe("generation_exceeded_safety_limit");
        expect(mocks.addLocalLog).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "inference.generation-safety-limit",
            errorCode: "GENERATION_EXCEEDED_SAFETY_LIMIT",
          })
        );

        void consume;
      } finally {
        vi.useRealTimers();
      }
    });

    it("completion clears the stall watchdog and the safety-limit timer (no leaked timers)", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] };
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        mocks.addLocalLog.mockClear();

        await vi.advanceTimersByTimeAsync(700_000);

        expect(mocks.addLocalLog).not.toHaveBeenCalled();
        expect(runtime.getState().status).toBe("ready");
      } finally {
        vi.useRealTimers();
      }
    });

    it("Stop clears the stall watchdog and the safety-limit timer", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "Par" }, finish_reason: null }] };
          await new Promise(() => {}); // never resolves; Stop must recover it
        })()
      );

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();
        await Promise.resolve();

        runtime.stopGeneration();
        mocks.addLocalLog.mockClear();

        // If the stall watchdog or safety-limit timer survived Stop, one of
        // them would fire well within this window and overwrite the
        // "cancelling" state with a stall/safety-limit error before the
        // cancel-confirmation timeout (15s) even gets a chance to.
        await vi.advanceTimersByTimeAsync(14_000);

        expect(runtime.getState().status).toBe("cancelling");
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.stall-timeout" })
        );
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.generation-safety-limit" })
        );

        void consume;
      } finally {
        vi.useRealTimers();
      }
    });

    it("runtime recovery clears the old generation's watchdog so it cannot affect the replacement runtime", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(new Promise(() => {})); // never resolves

      const staleRuntime = createInferenceRuntime(fakeWorker());
      await staleRuntime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(staleRuntime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();

        // The app recycles the runtime (e.g. after Stop's cancel_timeout)
        // well before the stale generation's own watchdog would fire.
        await staleRuntime.dispose();

        const replacementRuntime = createInferenceRuntime(fakeWorker());
        mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
          (async function* () {
            yield { choices: [{ delta: { content: "Recovered" }, finish_reason: "stop" }] };
          })()
        );
        await replacementRuntime.loadModel("test-model", { initialStatus: "recovering" });

        // Advance well past the stale generation's first-token threshold —
        // its watchdog must not still be armed against the new runtime.
        await vi.advanceTimersByTimeAsync(45_000);

        expect(replacementRuntime.getState().status).toBe("ready");
        expect(replacementRuntime.getState().error).toBeNull();

        void consume;
      } finally {
        vi.useRealTimers();
      }
    });

    it("setGenerationWatchdogSuspended pauses inactivity detection so a hidden tab does not immediately fail the generation", async () => {
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(new Promise(() => {})); // never resolves

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();

        runtime.setGenerationWatchdogSuspended(true);

        // Well past the 45s first-token threshold: while suspended, the
        // watchdog must not declare a timeout just because the tab is
        // (simulated) hidden.
        await vi.advanceTimersByTimeAsync(120_000);
        expect(runtime.getState().status).toBe("generating");
        expect(mocks.addLocalLog).not.toHaveBeenCalledWith(
          expect.objectContaining({ event: "inference.first-token-timeout" })
        );

        // Resuming grants a fresh window rather than instantly declaring a
        // stall from the (very large) backlog of "elapsed" time.
        runtime.setGenerationWatchdogSuspended(false);
        await vi.advanceTimersByTimeAsync(44_000);
        expect(runtime.getState().status).toBe("generating");

        await vi.advanceTimersByTimeAsync(1_000);
        expect(runtime.getState().status).toBe("error");
        expect(runtime.getState().error?.code).toBe("generation_stalled");

        void consume;
      } finally {
        vi.useRealTimers();
      }
    });

    it("is a safe no-op to suspend/resume the watchdog when no generation is active", async () => {
      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      expect(() => runtime.setGenerationWatchdogSuspended(true)).not.toThrow();
      expect(() => runtime.setGenerationWatchdogSuspended(false)).not.toThrow();
      expect(runtime.getState().status).toBe("ready");
    });

    it("never includes prompt content in the first-token-timeout, stall-timeout, or safety-limit technical logs", async () => {
      const secretPrompt = "super secret prompt for the watchdog privacy check";

      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(new Promise(() => {}));
      const firstTokenRuntime = createInferenceRuntime(fakeWorker());
      await firstTokenRuntime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const consumeFirst = drain(firstTokenRuntime.generate({ conversationId: "c1", prompt: secretPrompt }));
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(45_000);
        void consumeFirst;

        mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
          (async function* () {
            yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
            await new Promise(() => {});
          })()
        );
        const stallRuntime = createInferenceRuntime(fakeWorker());
        await stallRuntime.loadModel("test-model");
        const consumeStall = drain(stallRuntime.generate({ conversationId: "c2", prompt: secretPrompt }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(45_000);
        void consumeStall;

        mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
          (async function* () {
            while (true) {
              await new Promise((resolve) => setTimeout(resolve, 10_000));
              yield { choices: [{ delta: { content: "x" }, finish_reason: null }] };
            }
          })()
        );
        const safetyLimitRuntime = createInferenceRuntime(fakeWorker());
        await safetyLimitRuntime.loadModel("test-model");
        const consumeSafetyLimit = drain(safetyLimitRuntime.generate({ conversationId: "c3", prompt: secretPrompt }));
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(600_000);
        void consumeSafetyLimit;

        for (const call of [...mocks.createLogEvent.mock.calls, ...mocks.addLocalLog.mock.calls]) {
          expect(JSON.stringify(call)).not.toContain(secretPrompt);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("a stale timer from an abandoned generation cannot cancel a new generation on the same runtime", async () => {
      // generation A stalls waiting for its first token; forceRecovery
      // resolves it (bumping the epoch) before generation B ever starts, so
      // this asserts the structural guarantee (fresh watchdog instance +
      // epoch check) rather than a literal concurrent-generation race,
      // which createInferenceRuntime does not allow.
      mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(new Promise(() => {}));

      const runtime = createInferenceRuntime(fakeWorker());
      await runtime.loadModel("test-model");

      vi.useFakeTimers();
      try {
        const firstGeneration = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(45_000);
        expect(runtime.getState().error?.code).toBe("generation_stalled");
        void firstGeneration;

        // Recover and start a brand-new generation B on the same runtime.
        await runtime.loadModel("test-model", { initialStatus: "recovering" });
        mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
          (async function* () {
            yield { choices: [{ delta: { content: "B" }, finish_reason: null }] };
            await new Promise(() => {}); // B is itself still in flight
          })()
        );
        mocks.addLocalLog.mockClear();
        const secondGeneration = drain(runtime.generate({ conversationId: "c2", prompt: "hi again" }));
        await Promise.resolve();
        await Promise.resolve();
        expect(runtime.getState().status).toBe("generating");

        // Advance by less than B's own stall threshold measured from its
        // own first token: if a leftover callback from A could still act,
        // it would have fired long before this point (A's window elapsed
        // entirely before B even started).
        await vi.advanceTimersByTimeAsync(10_000);
        expect(runtime.getState().status).toBe("generating");
        expect(runtime.getState().error).toBeNull();

        void secondGeneration;
      } finally {
        vi.useRealTimers();
      }
    });
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
          performanceMetrics: {
            firstTokenMs: 100,
            tokensPerSecond: 1,
            totalTimeMs: 2000,
            tokenCountConfidence: "unavailable",
          },
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

  describe("GenerationRuntimeMetrics (Phase 1: runtime-backed performance metrics)", () => {
    // Mirrors the installed @mlc-ai/web-llm 0.2.84 API exactly (see
    // runtime.ts's own top-of-file note): content/finish_reason chunks
    // carry `usage: null` when `stream_options.include_usage` was
    // requested, and the real payload arrives on a SEPARATE trailer chunk
    // with `choices: []`.
    function streamWithUsage(usage: unknown) {
      return (async function* () {
        yield { choices: [{ delta: { content: "Hi" }, finish_reason: null }], usage: null };
        yield { choices: [{ delta: {}, finish_reason: "stop" }], usage: null };
        yield { choices: [], usage };
      })();
    }

    function expectDone(chunk: GenerateChunk | undefined): Extract<GenerateChunk, { type: "done" }> {
      if (chunk?.type !== "done") throw new Error(`expected a "done" chunk, got ${JSON.stringify(chunk)}`);
      return chunk;
    }

    describe("exact token usage", () => {
      it("requests WebLLM's usage trailer on every generation via stream_options.include_usage", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }] };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(mocks.mockEngine.chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({ stream_options: { include_usage: true } })
        );
      });

      it("captures exact generated-token and prompt-token counts, with no prompt-throughput field on the exact usage object", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: 5, prompt_tokens: 10, total_tokens: 15 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        // generationStartedAt=0, firstTokenAt=100 (TTFT), totalTimeMs read
        // at 1000 -> generationDurationMs=1000 (the FULL inference
        // wall-clock, including the usage trailer wait -- see
        // "overallCompletionTokensPerSecond is completion tokens divided
        // by the FULL inference wall-clock" below, not this 100-1000 span).
        const timestamps = [0, 100, 1000];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 1000);

        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        const done = expectDone(chunks.at(-1));

        expect(done.metrics.usage).toEqual({
          tokenCountConfidence: "exact",
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          overallCompletionTokensPerSecond: 5, // 5 tokens / (1000ms / 1000)
        });
        // No prompt-throughput field survives on the exact usage object at
        // all -- `promptTokens / timeToFirstTokenMs` is not exact prefill
        // throughput (see types.ts), so it is never exposed as one, not
        // even as a nullable field.
        expect("promptTokensPerSecond" in done.metrics.usage).toBe(false);
        expect(done.metrics.inferenceStartedAt).toBe(0);
        expect(done.metrics.firstTokenAt).toBe(100);
        expect(done.metrics.timeToFirstTokenMs).toBe(100);
        expect(done.metrics.completedAt).toBe(1000);
        expect(done.metrics.generationDurationMs).toBe(1000);

        vi.restoreAllMocks();
      });

      it("overallCompletionTokensPerSecond is completion tokens divided by ai-runtime's FULL inference wall-clock, never a decode-only surrogate", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: 5, prompt_tokens: 10, total_tokens: 15 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        // start=0, first real token=100, stream/usage trailer fully
        // consumed=1000 -> generationDurationMs=1000 (0 to 1000), NOT the
        // 900ms decode-only span from firstTokenAt (100) to completion
        // (1000). 5 completion tokens / (1000ms/1000) = 5 exactly; the
        // decode-only surrogate would instead be 5 / (900ms/1000) =
        // 5.555..., a materially different number this assertion rules out.
        const timestamps = [0, 100, 1000];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 1000);

        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        const usage = expectDone(chunks.at(-1)).metrics.usage;

        expect(usage.tokenCountConfidence).toBe("exact");
        if (usage.tokenCountConfidence === "exact") {
          expect(usage.overallCompletionTokensPerSecond).toBe(5);
          expect(usage.overallCompletionTokensPerSecond).not.toBeCloseTo(5.555, 2);
        }

        vi.restoreAllMocks();
      });

      it("reports unavailable usage when WebLLM never sends a usage payload at all", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }] };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(expectDone(chunks.at(-1)).metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
      });

      it("rejects a fractional generated-token count rather than trusting a partially-valid payload", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: 5.5, prompt_tokens: 10, total_tokens: 15.5 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(expectDone(chunks.at(-1)).metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
      });

      it("rejects a negative token count", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: -1, prompt_tokens: 10, total_tokens: 9 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(expectDone(chunks.at(-1)).metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
      });

      it("rejects a NaN generated-token count", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: Number.NaN, prompt_tokens: 10, total_tokens: 10 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(expectDone(chunks.at(-1)).metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
      });

      it("rejects an Infinite generated-token count", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: Infinity, prompt_tokens: 10, total_tokens: Infinity })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(expectDone(chunks.at(-1)).metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
      });

      it("rejects a usage payload whose total does not equal prompt + completion", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: 5, prompt_tokens: 10, total_tokens: 999 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(expectDone(chunks.at(-1)).metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
      });

      it("treats zero generated tokens as a valid exact measurement with a zero rate, not a malformed payload", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: 0, prompt_tokens: 10, total_tokens: 10 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        // Guarantees a strictly positive generationDurationMs: a real,
        // unmocked test run can otherwise complete in 0ms, which would
        // itself (correctly) degrade this to "unavailable" and mask what
        // this test is actually checking.
        const timestamps = [0, 100, 500];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 500);

        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        const usage = expectDone(chunks.at(-1)).metrics.usage;
        expect(usage.tokenCountConfidence).toBe("exact");
        if (usage.tokenCountConfidence === "exact") {
          expect(usage.completionTokens).toBe(0);
          expect(usage.overallCompletionTokensPerSecond).toBe(0);
        }

        vi.restoreAllMocks();
      });

      it("logs exact token counts/confidence in the local technical log, never the heuristic chunk-derived count", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: 5, prompt_tokens: 10, total_tokens: 15 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        const timestamps = [0, 100, 500];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 500);

        await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(mocks.addLocalLog).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "inference.completed",
            performanceMetrics: expect.objectContaining({
              tokenCountConfidence: "exact",
              exactGeneratedTokenCount: 5,
              exactPromptTokenCount: 10,
            }),
          })
        );

        vi.restoreAllMocks();
      });
    });

    describe("time to first token", () => {
      it("records TTFT from the first raw content chunk", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
            yield { choices: [{ delta: { content: "lo" }, finish_reason: null }] };
            yield { choices: [{ delta: {}, finish_reason: "stop" }] };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        const timestamps = [0, 50, 200];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 200);

        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        expect(expectDone(chunks.at(-1)).metrics.timeToFirstTokenMs).toBe(50);

        vi.restoreAllMocks();
      });

      it("does not overwrite the first-token timestamp on later chunks", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: { content: "A" }, finish_reason: null }] };
            yield { choices: [{ delta: { content: "B" }, finish_reason: null }] };
            yield { choices: [{ delta: { content: "C" }, finish_reason: null }] };
            yield { choices: [{ delta: {}, finish_reason: "stop" }] };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        // Only ONE Date.now() call happens for firstTokenAt (guarded by
        // `if (firstTokenAt === null)`), regardless of how many further
        // content chunks arrive -- so this array is exactly as long as
        // "records TTFT" above: generationStartedAt, firstTokenAt, totalTimeMs.
        const timestamps = [0, 30, 500];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 500);

        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        const done = expectDone(chunks.at(-1));
        expect(done.metrics.firstTokenAt).toBe(30);
        expect(done.metrics.timeToFirstTokenMs).toBe(30);

        vi.restoreAllMocks();
      });

      it("does not count an empty/non-progress chunk as the first token", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: {}, finish_reason: null }] }; // no content -- must not count
            yield { choices: [{ delta: { content: "Hi" }, finish_reason: null }] };
            yield { choices: [{ delta: {}, finish_reason: "stop" }] };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        // The empty chunk never calls Date.now() at all (gated by `if
        // (text)`), so this sequence is unaffected by it: generationStartedAt,
        // firstTokenAt (on the REAL "Hi" chunk), totalTimeMs.
        const timestamps = [0, 10, 40];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 40);

        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        expect(expectDone(chunks.at(-1)).metrics.timeToFirstTokenMs).toBe(10);

        vi.restoreAllMocks();
      });

      it("captures TTFT the instant the raw chunk arrives, unaffected by how slowly the caller consumes the generator afterward (simulated UI buffering delay)", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
            yield { choices: [{ delta: {}, finish_reason: "stop" }] };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        const timestamps = [1000, 1050, 1050];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 1050);

        const generator = runtime.generate({ conversationId: "c1", prompt: "hi" });
        const first = await generator.next();
        expect(first.value).toEqual({ type: "token", text: "Hel" });

        // A slow downstream consumer (e.g. a UI flush buffer) taking real
        // wall-clock time before asking for the next chunk must never be
        // able to inflate TTFT -- it was already captured, from the mocked
        // clock, the instant the raw chunk was read above.
        await new Promise((resolve) => setTimeout(resolve, 5));

        const second = await generator.next();
        const done = expectDone(second.value);
        expect(done.metrics.timeToFirstTokenMs).toBe(50);

        vi.restoreAllMocks();
      });
    });

    describe("lifecycle correctness", () => {
      it("attaches unavailable-usage metrics (never fabricated) to a length-limited completion", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: { content: "Partial" }, finish_reason: null }] };
            yield { choices: [{ delta: {}, finish_reason: "length" }] };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        const done = expectDone(chunks.at(-1));

        expect(done.reason).toBe("length");
        expect(done.metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
      });

      it("attaches unavailable-usage metrics to a user Stop (abort mid-stream)", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: { content: "Par" }, finish_reason: null }] };
            yield { choices: [{ delta: {}, finish_reason: "abort" }] };
            // Never reached: the loop breaks on "abort" before it could see
            // this, even if WebLLM would otherwise have sent one.
            yield { choices: [], usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 } };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        const done = expectDone(chunks.at(-1));

        expect(done.reason).toBe("cancelled");
        expect(done.metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
      });

      it("attaches unavailable-usage metrics to a degenerate-output interruption", async () => {
        const unstableOutput = "<>".repeat(GENERATION_SAFETY_LIMITS.maxRepeatedSymbolBlockRun + 1);
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          (async function* () {
            yield { choices: [{ delta: { content: unstableOutput }, finish_reason: null }] };
          })()
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        const done = expectDone(chunks.at(-1));

        expect(done.reason).toBe("degenerate_output");
        expect(done.metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
        expect(done.metrics.inferenceStartedAt).toEqual(expect.any(Number));
        expect(done.metrics.generationDurationMs).toEqual(expect.any(Number));
      });

      it("attaches unavailable-usage metrics when a thrown runtime error is classified as a clean cancellation", async () => {
        mocks.mockEngine.chat.completions.create.mockRejectedValue(new Error("generation was interrupted"));
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
        const done = expectDone(chunks.at(-1));

        expect(done.reason).toBe("cancelled");
        expect(done.metrics.usage).toEqual({ tokenCountConfidence: "unavailable" });
        expect(done.metrics.generationDurationMs).toEqual(expect.any(Number));
      });

      it("never attaches metrics to a genuine error chunk (a real runtime failure stays a plain error, not a fabricated done)", async () => {
        mocks.mockEngine.chat.completions.create.mockRejectedValue(new Error("device lost, out of memory"));
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));

        expect(chunks).toEqual([{ type: "error", error: { code: "out_of_memory", message: "device lost, out of memory" } }]);
      });

      it("never lets a stale chunk from an abandoned generation contribute usage to the generation that superseded it", async () => {
        // The epoch check at the very top of the loop runs BEFORE this
        // phase's new `if (chunk.usage) capturedUsage = chunk.usage;` line
        // -- so a chunk arriving after forceRecovery() has already bumped
        // the epoch is discarded before its usage is ever inspected. This
        // reproduces exactly that stall+late-chunk shape used elsewhere in
        // this file, with an added (never-consulted) usage trailer.
        let releaseLateChunk: (() => void) | undefined;
        mocks.mockEngine.chat.completions.create.mockResolvedValueOnce(
          (async function* () {
            yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
            await new Promise<void>((resolve) => {
              releaseLateChunk = resolve;
            });
            yield { choices: [], usage: { completion_tokens: 999, prompt_tokens: 999, total_tokens: 1998 } };
          })()
        );

        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        vi.useFakeTimers();
        try {
          const consume = drain(runtime.generate({ conversationId: "c1", prompt: "hi" }));
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();

          await vi.advanceTimersByTimeAsync(45_000);
          expect(runtime.getState().error?.code).toBe("generation_stalled");

          releaseLateChunk?.();
          const chunks = await consume;

          // The stale chunk's usage never surfaces anywhere: this
          // generation resolved via the forced error path, which carries
          // no metrics at all.
          expect(chunks.every((chunk) => chunk.type !== "done")).toBe(true);
          expect(JSON.stringify(chunks)).not.toContain("999");
        } finally {
          vi.useRealTimers();
        }
      });

      it("keeps each generate() call's metrics fully independent -- separate Continue attempts never aggregate into one fake combined measurement", async () => {
        mocks.mockEngine.chat.completions.create
          .mockResolvedValueOnce(streamWithUsage({ completion_tokens: 5, prompt_tokens: 5, total_tokens: 10 }))
          .mockResolvedValueOnce(streamWithUsage({ completion_tokens: 50, prompt_tokens: 50, total_tokens: 100 }));

        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");

        // Two independent positive-duration windows, one per generate()
        // call: (generationStartedAt, firstTokenAt, totalTimeMs) x 2.
        const timestamps = [0, 10, 100, 200, 210, 300];
        vi.spyOn(Date, "now").mockImplementation(() => timestamps.shift() ?? 300);

        const firstChunks = await drain(runtime.generate({ conversationId: "c1", prompt: "first attempt" }));
        const secondChunks = await drain(runtime.generate({ conversationId: "c1", prompt: "continue" }));

        const firstUsage = expectDone(firstChunks.at(-1)).metrics.usage;
        const secondUsage = expectDone(secondChunks.at(-1)).metrics.usage;

        expect(firstUsage).toMatchObject({ tokenCountConfidence: "exact", completionTokens: 5 });
        expect(secondUsage).toMatchObject({ tokenCountConfidence: "exact", completionTokens: 50 });

        vi.restoreAllMocks();
      });
    });

    describe("privacy", () => {
      it("never leaks the prompt or any content-shaped text through GenerationRuntimeMetrics, even with an adversarial prompt", async () => {
        mocks.mockEngine.chat.completions.create.mockResolvedValue(
          streamWithUsage({ completion_tokens: 3, prompt_tokens: 3, total_tokens: 6 })
        );
        const runtime = createInferenceRuntime(fakeWorker());
        await runtime.loadModel("test-model");
        const secretPrompt = "super secret prompt mentioning reasoning, messages, systemPrompt, and rawOutput";
        const chunks = await drain(runtime.generate({ conversationId: "c1", prompt: secretPrompt }));
        const done = expectDone(chunks.at(-1));

        expect(JSON.stringify(done.metrics)).not.toContain("secret");
        // The metrics object's own top-level shape is a closed, known
        // allowlist -- proving no extra/injected field could have carried
        // content through.
        expect(Object.keys(done.metrics).sort()).toEqual(
          ["completedAt", "firstTokenAt", "generationDurationMs", "inferenceStartedAt", "timeToFirstTokenMs", "usage"].sort()
        );

        for (const call of [...mocks.createLogEvent.mock.calls, ...mocks.addLocalLog.mock.calls]) {
          expect(JSON.stringify(call)).not.toContain("secret");
        }
      });
    });
  });
});

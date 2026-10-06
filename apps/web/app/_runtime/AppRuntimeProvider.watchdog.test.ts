// @vitest-environment jsdom
//
// Mounted-provider tests for watchdog recovery under runtime ownership. They
// mount the REAL AppRuntimeProvider (real lifecycle, real operation
// coordinator, real routing hook, real watchdog effect and recovery) against
// a fake WebLLM-free runtime/worker pair, so a non-cooperative generation
// stream -- one that never ends and never reaches the owner's `finally` --
// can be simulated exactly the way ai-runtime's forced recovery leaves it:
// the runtime state flips to "error" while the stream stays stuck.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GenerateChunk,
  GenerateInput,
  GenerationRuntimeMetrics,
  InferenceRuntime,
  LoadModelOptions,
  RuntimeErrorCode,
  RuntimeOperationCoordinator,
  RuntimeState,
} from "@free-ai-open/ai-runtime";
import { DEFAULT_MODEL_ID } from "@free-ai-open/ai-runtime";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import { setStoredPerformanceMode } from "../_lib/gettingStartedPreference";

const harness = vi.hoisted(() => ({
  coordinator: null as RuntimeOperationCoordinator | null,
  acquireLog: [] as Array<{ owner: string; granted: boolean }>,
  events: [] as string[],
  runtimes: [] as Array<{ label: string }>,
  createRuntimeImpl: null as null | ((worker: unknown) => unknown),
  // When set, the router "runs": buildRouterInputContext returns a stub input
  // and routeAdaptiveModel returns this decision. Null keeps routing inert.
  routerDecision: null as null | Record<string, unknown>,
  modelsCached: false,
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
vi.mock("../_i18n/LocaleContext", () => ({ useLocale: () => ({ locale: "en", setLocale: () => {} }) }));
// A hung replacement model load must time out within the test's patience.
vi.mock("../_lib/replacementLoadBound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_lib/replacementLoadBound")>();
  return { ...actual, RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS: 150 };
});
vi.mock("./routingOrchestration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routingOrchestration")>();
  return {
    ...actual,
    buildRouterInputContext: async () =>
      harness.routerDecision
        ? {
            task: "general",
            locale: "en",
            performanceMode: "balanced",
            capability: { detectedAt: "2026-01-01T00:00:00.000Z" },
            benchmark: undefined,
            manualModelId: undefined,
            cachedModelIds: [],
            registryVersion: "test",
            observations: [],
          }
        : null,
  };
});
vi.mock("@free-ai-open/model-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@free-ai-open/model-router")>();
  return {
    ...actual,
    routeAdaptiveModel: (input: never) => (harness.routerDecision ?? actual.routeAdaptiveModel(input)) as never,
  };
});
vi.mock("@free-ai-open/ai-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@free-ai-open/ai-runtime")>();
  return {
    ...actual,
    isModelCached: async () => harness.modelsCached,
    createRuntimeOperationCoordinator: () => {
      const coordinator = actual.createRuntimeOperationCoordinator();
      const original = coordinator.tryAcquire.bind(coordinator);
      coordinator.tryAcquire = (owner: string) => {
        const lease = original(owner);
        harness.acquireLog.push({ owner, granted: lease !== null });
        return lease;
      };
      harness.coordinator = coordinator;
      return coordinator;
    },
    createInferenceRuntime: (worker: unknown) => harness.createRuntimeImpl?.(worker),
  };
});

import { AppRuntimeProvider, useAppRuntime } from "./AppRuntimeProvider";

const DONE_METRICS: GenerationRuntimeMetrics = {
  inferenceStartedAt: 0,
  firstTokenAt: 1,
  timeToFirstTokenMs: 1,
  completedAt: 2,
  generationDurationMs: 2,
  usage: { tokenCountConfidence: "unavailable" },
};

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// --- fake worker / runtime ---------------------------------------------------

let workerCount = 0;
let terminateShouldFail = false;
let terminateFailsForWorker: number | null = null;
const workers: FakeWorker[] = [];

class FakeWorker {
  readonly id: number;
  constructor() {
    workerCount += 1;
    this.id = workerCount;
    workers.push(this);
    harness.events.push(`worker:create:${this.id}`);
  }
  postMessage(): void {}
  terminate(): void {
    harness.events.push(`worker:terminate:${this.id}`);
    if (terminateShouldFail || terminateFailsForWorker === this.id) throw new Error("terminate failed");
  }
}

interface FakeRt extends InferenceRuntime {
  label: string;
  forceError(code: RuntimeErrorCode): void;
  setRaw(patch: Partial<RuntimeState>): void;
}

let runtimeCount = 0;
let loadShouldFailForRuntimeNumber: number | null = null;
// A load that NEVER settles (an uncooperative replacement)...
let loadHangsForRuntimeNumber: number | null = null;
// ...or one that settles, but only long after the bound expired.
let loadLateForRuntimeNumber: { number: number; afterMs: number } | null = null;
const lateLoadCalls: string[] = [];
let disposeImpl: (label: string) => Promise<void> = async () => {};
let generateImpl: (label: string, input: GenerateInput, callIndex: number) => AsyncGenerator<GenerateChunk>;
let generateCallCount = 0;
const liveRuntimes: FakeRt[] = [];
const generateLog: Array<{ label: string; prompt: string }> = [];

function createFakeRuntime(): FakeRt {
  runtimeCount += 1;
  const number = runtimeCount;
  const label = `runtime-${number}`;
  let state: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };
  const listeners = new Set<(state: RuntimeState) => void>();
  const setRaw = (patch: Partial<RuntimeState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  harness.runtimes.push({ label });

  return {
    label,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async loadModel(modelId = "default", options?: LoadModelOptions) {
      setRaw({ status: options?.initialStatus ?? "loading_model", modelId, loadProgress: 0, error: null });
      await Promise.resolve();
      if (loadHangsForRuntimeNumber === number) await new Promise<never>(() => {});
      if (loadLateForRuntimeNumber?.number === number) {
        await new Promise((resolve) => setTimeout(resolve, loadLateForRuntimeNumber!.afterMs));
        lateLoadCalls.push(label);
      }
      if (loadShouldFailForRuntimeNumber === number) {
        setRaw({ status: "error", error: { code: "model_load_failed", message: "load failed" } });
        return null;
      }
      setRaw({ status: "ready", loadProgress: 1 });
      return { loadTimeMs: 1 };
    },
    generate(input) {
      generateLog.push({ label, prompt: input.prompt });
      if (state.status !== "ready") {
        return (async function* (): AsyncGenerator<GenerateChunk> {
          yield { type: "error", error: { code: "unknown", message: "Runtime is not ready to generate." } };
        })();
      }
      const callIndex = generateCallCount;
      generateCallCount += 1;
      setRaw({ status: "generating" });
      const inner = generateImpl(label, input, callIndex);
      return (async function* (): AsyncGenerator<GenerateChunk> {
        for await (const chunk of inner) {
          // ai-runtime returns to "ready" just before yielding a done chunk.
          if (chunk.type === "done" && state.status === "generating") setRaw({ status: "ready" });
          yield chunk;
        }
      })();
    },
    stopGeneration() {},
    setGenerationWatchdogSuspended() {},
    async dispose() {
      harness.events.push(`runtime:dispose:start:${label}`);
      try {
        await disposeImpl(label);
      } finally {
        harness.events.push(`runtime:dispose:end:${label}`);
        state = { status: "idle", modelId: null, loadProgress: 0, error: null };
      }
    },
    forceError(code) {
      setRaw({ status: "error", error: { code, message: "forced by watchdog" } });
    },
    setRaw,
  };
}

async function* stuckStream(): AsyncGenerator<GenerateChunk> {
  yield { type: "token", text: "partial reply" };
  await new Promise<never>(() => {});
}

async function* lengthLimitedStream(): AsyncGenerator<GenerateChunk> {
  yield { type: "token", text: "A partial answer that stopped at the output limit." };
  // Let the provider's buffered renderer (80ms interval) flush the token
  // into the visible transcript while the generation is still active, the way
  // a real streamed reply would.
  await new Promise((resolve) => setTimeout(resolve, 200));
  yield { type: "done", reason: "length", metrics: DONE_METRICS };
}

async function* completedStream(): AsyncGenerator<GenerateChunk> {
  yield { type: "token", text: "Hello from the recovered runtime." };
  yield { type: "done", reason: "completed", metrics: DONE_METRICS };
}

// --- mounting -----------------------------------------------------------------

type ProviderContext = ReturnType<typeof useAppRuntime>;

let root: Root | null = null;
let container: HTMLElement | null = null;
let latest: ProviderContext | null = null;

function Probe() {
  latest = useAppRuntime();
  return null;
}

const ctx = (): ProviderContext => {
  if (!latest) throw new Error("provider not mounted yet");
  return latest;
};

async function mountProvider(): Promise<void> {
  setStoredPerformanceMode("balanced");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(createElement(AppRuntimeProvider, null, createElement(Probe)));
  await vi.waitFor(
    () => {
      expect(ctx().runtimeState.status).toBe("ready");
    },
    { timeout: 5_000 }
  );
}

function coordinator(): RuntimeOperationCoordinator {
  if (!harness.coordinator) throw new Error("coordinator not created");
  return harness.coordinator;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  localStorage.clear();
  harness.coordinator = null;
  harness.routerDecision = null;
  harness.modelsCached = false;
  harness.acquireLog = [];
  harness.events = [];
  harness.runtimes = [];
  workerCount = 0;
  workers.length = 0;
  runtimeCount = 0;
  terminateShouldFail = false;
  terminateFailsForWorker = null;
  loadShouldFailForRuntimeNumber = null;
  loadHangsForRuntimeNumber = null;
  loadLateForRuntimeNumber = null;
  lateLoadCalls.length = 0;
  disposeImpl = async () => {};
  generateCallCount = 0;
  generateLog.length = 0;
  generateImpl = () => completedStream();
  latest = null;
  liveRuntimes.length = 0;
  harness.createRuntimeImpl = () => {
    const runtime = createFakeRuntime();
    liveRuntimes.push(runtime);
    return runtime;
  };
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

// The provider's own lifecycle owns runtimes; the harness records creation
// order, and the most recently created fake is the live one.
function currentRuntime(): FakeRt {
  return liveRuntimes[liveRuntimes.length - 1]!;
}

describe("AppRuntimeProvider -- watchdog recovery under the active runtime lease", () => {
  it("sendMessage + non-cooperative stream: cancel_timeout recovery runs under the ACTIVE lease, replacement is physically sequential, the old operation is neutralized, the lease releases, and the next chat runs", async () => {
    const blockedTeardown = createDeferred();
    disposeImpl = (label) => (label === "runtime-1" ? blockedTeardown.promise : Promise.resolve());
    generateImpl = (label) => (label === "runtime-1" ? stuckStream() : completedStream());
    await mountProvider();
    expect(workers).toHaveLength(1);
    const acquisitionsBeforeGeneration = harness.acquireLog.length;

    let staleSendSettled = false;
    void ctx().sendMessage("hello", "en").then(() => {
      staleSendSettled = true;
    });
    await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
    expect(coordinator().currentOwner()).toBe("chat-generation");

    // ai-runtime's forced recovery: the state flips to "error" while the
    // stream is stuck and never reaches the owner's `finally`.
    currentRuntime().forceError("cancel_timeout");

    // Teardown is deliberately blocked: recovery is mid-flight.
    await vi.waitFor(() => expect(harness.events).toContain("runtime:dispose:start:runtime-1"));
    await settle();
    // (1) Recovery uses the ACTIVE lease -- it never asked for a second one.
    expect(harness.acquireLog.slice(acquisitionsBeforeGeneration).map((entry) => entry.owner)).toEqual(["chat-generation"]);
    expect(coordinator().currentOwner()).toBe("chat-generation");
    // (2) Physically sequential: no replacement worker/runtime yet.
    expect(workers).toHaveLength(1);
    expect(runtimeCount).toBe(1);
    // (3) A third operation cannot acquire the runtime during recovery, and
    // a chat send is refused.
    expect(coordinator().tryAcquire("third-operation")).toBeNull();
    expect(await ctx().sendMessage("third message", "en")).toBe(false);

    blockedTeardown.resolve();
    await vi.waitFor(() => expect(ctx().runtimeState.status).toBe("ready"), { timeout: 5_000 });

    // Old worker terminated BEFORE the replacement worker was created.
    const terminated = harness.events.indexOf("worker:terminate:1");
    const created = harness.events.indexOf("worker:create:2");
    expect(terminated).toBeGreaterThanOrEqual(0);
    expect(created).toBeGreaterThan(terminated);
    // The lease released only after recovery completed; nothing quarantined.
    await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull());
    expect(coordinator().isQuarantined()).toBe(false);
    // The old, stuck operation is neutralized: it never completes, and the
    // generation it owned is no longer active.
    expect(staleSendSettled).toBe(false);
    expect(ctx().generation.generationId).toBeNull();
    // Still no second-lease acquisition was ever needed for recovery.
    expect(harness.acquireLog.map((entry) => entry.owner)).not.toContain("app-runtime:recovery");

    // The next chat runs on the replacement runtime.
    expect(await ctx().sendMessage("next message", "en")).toBe(true);
    expect(generateLog.at(-1)).toEqual({ label: "runtime-2", prompt: "next message" });
    expect(coordinator().currentOwner()).toBeNull();
  });

  it("Continue + non-cooperative stream: same ownership-scoped recovery, then the next chat runs", async () => {
    generateImpl = (label, _input, callIndex) => {
      if (callIndex === 0) return lengthLimitedStream();
      return label === "runtime-1" ? stuckStream() : completedStream();
    };
    await mountProvider();

    expect(await ctx().sendMessage("write something long", "en")).toBe(true);
    await vi.waitFor(() => expect(ctx().canContinueGeneration).toBe(true));

    let staleContinueSettled = false;
    void ctx().continueGeneration().then(() => {
      staleContinueSettled = true;
    });
    await vi.waitFor(() => expect(coordinator().currentOwner()).toBe("chat-continuation"));
    await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());

    currentRuntime().forceError("cancel_timeout");

    await vi.waitFor(() => expect(ctx().runtimeState.status).toBe("ready"), { timeout: 5_000 });
    expect(workers).toHaveLength(2);
    expect(harness.events.indexOf("worker:create:2")).toBeGreaterThan(harness.events.indexOf("worker:terminate:1"));
    expect(harness.acquireLog.filter((entry) => entry.owner.includes("recovery"))).toEqual([]);
    await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull());
    expect(coordinator().isQuarantined()).toBe(false);
    expect(staleContinueSettled).toBe(false);

    expect(await ctx().sendMessage("after continue", "en")).toBe(true);
    expect(generateLog.at(-1)?.label).toBe("runtime-2");
  });

  it("isolation not proven (the old worker cannot be terminated): NO replacement is created, ownership is quarantined, and an explicit reload that confirms isolation lifts it", async () => {
    generateImpl = (label) => (label === "runtime-1" ? stuckStream() : completedStream());
    await mountProvider();
    terminateShouldFail = true;

    void ctx().sendMessage("hello", "en");
    await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
    currentRuntime().forceError("cancel_timeout");

    await vi.waitFor(() => expect(coordinator().isQuarantined()).toBe(true), { timeout: 5_000 });
    // No replacement worker/runtime was ever created while the old one could
    // still be alive, and the coordinator is not available to normal work.
    expect(workers).toHaveLength(1);
    expect(runtimeCount).toBe(1);
    expect(coordinator().tryAcquire("normal-operation")).toBeNull();
    expect(await ctx().sendMessage("blocked while quarantined", "en")).toBe(false);

    // Isolation becomes possible: an explicit reload retries it, lifts the
    // quarantine only on confirmation, and then replaces the runtime.
    terminateShouldFail = false;
    expect(await ctx().reloadRuntime()).toBe(true);
    expect(coordinator().isQuarantined()).toBe(false);
    expect(workers).toHaveLength(2);
    expect(harness.events.indexOf("worker:create:2")).toBeGreaterThan(harness.events.lastIndexOf("worker:terminate:1"));
    await vi.waitFor(() => expect(ctx().runtimeState.status).toBe("ready"));
    expect(await ctx().sendMessage("recovered", "en")).toBe(true);
  });

  it("isolated=true, ready=false: ownership is released (the old domain is gone) but the user is told the runtime is not usable", async () => {
    generateImpl = (label) => (label === "runtime-1" ? stuckStream() : completedStream());
    await mountProvider();
    loadShouldFailForRuntimeNumber = 2;

    void ctx().sendMessage("hello", "en");
    await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
    currentRuntime().forceError("cancel_timeout");

    await vi.waitFor(() => expect(ctx().storageNotice?.key).toBe("storageNotice.runtimeRecoveryFailed"), { timeout: 5_000 });
    // Isolated: the old worker was terminated and the lease is NOT stuck.
    expect(harness.events).toContain("worker:terminate:1");
    await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull());
    expect(coordinator().isQuarantined()).toBe(false);
    // Not ready: the replacement could not load a model.
    expect(ctx().runtimeState.status).toBe("error");
    expect(await ctx().sendMessage("cannot send", "en")).toBe(false);
  });

  it("a stall (refresh_routing code) with a non-cooperative stream is isolated under the lease after the grace period, and the next chat runs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      generateImpl = (label) => (label === "runtime-1" ? stuckStream() : completedStream());
      await mountProvider();

      void ctx().sendMessage("hello", "en");
      await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
      currentRuntime().forceError("generation_stalled");

      // Within the owner-release grace period nothing is torn down yet.
      await vi.advanceTimersByTimeAsync(4_000);
      expect(workers).toHaveLength(1);
      expect(coordinator().currentOwner()).toBe("chat-generation");

      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(ctx().runtimeState.status).toBe("ready"), { timeout: 5_000 });

      expect(workers).toHaveLength(2);
      expect(harness.events.indexOf("worker:create:2")).toBeGreaterThan(harness.events.indexOf("worker:terminate:1"));
      expect(harness.acquireLog.filter((entry) => entry.owner.includes("recovery"))).toEqual([]);
      await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull());
      vi.useRealTimers();
      expect(await ctx().sendMessage("after stall", "en")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("sendMessage + non-cooperative stream + a replacement load that NEVER resolves: the replacement is bounded and ISOLATED too, recovery ends isolated=true/ready=false, the lease releases, and another operation can acquire", async () => {
    generateImpl = (label) => (label === "runtime-1" ? stuckStream() : completedStream());
    loadHangsForRuntimeNumber = 2;
    await mountProvider();

    void ctx().sendMessage("hello", "en");
    await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
    expect(coordinator().currentOwner()).toBe("chat-generation");
    currentRuntime().forceError("cancel_timeout");

    // (1) The OLD worker is isolated first, then the replacement is created...
    await vi.waitFor(() => expect(harness.events).toContain("worker:create:2"), { timeout: 5_000 });
    expect(harness.events.indexOf("worker:terminate:1")).toBeLessThan(harness.events.indexOf("worker:create:2"));
    // ...and while its load hangs the lease is still held (nobody else runs).
    expect(coordinator().currentOwner()).toBe("chat-generation");
    expect(coordinator().tryAcquire("too-early")).toBeNull();

    // (2) The bounded replacement load expires: the REPLACEMENT worker is
    // terminated as well -- no uncooperative load outlives the lease.
    await vi.waitFor(() => expect(harness.events).toContain("worker:terminate:2"), { timeout: 5_000 });
    expect(harness.events.indexOf("worker:terminate:2")).toBeGreaterThan(harness.events.indexOf("worker:create:2"));
    // No third worker was ever created behind it.
    expect(workers).toHaveLength(2);

    // (3) isolated=true, ready=false: the lease is RELEASED (not quarantined)
    // and the user is told the runtime is not usable.
    await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull(), { timeout: 5_000 });
    expect(coordinator().isQuarantined()).toBe(false);
    await vi.waitFor(() => expect(ctx().storageNotice?.key).toBe("storageNotice.runtimeRecoveryFailed"));
    expect(ctx().runtimeState.status).toBe("error");

    // (4) Another runtime operation can acquire it -- and a plain reload then
    // brings a working runtime back.
    const third = coordinator().tryAcquire("third-operation");
    expect(third).not.toBeNull();
    third?.release();
    loadHangsForRuntimeNumber = null;
    expect(await ctx().reloadRuntime()).toBe(true);
    await vi.waitFor(() => expect(ctx().runtimeState.status).toBe("ready"));
    expect(await ctx().sendMessage("after the hang", "en")).toBe(true);
  });

  it("Continue + non-cooperative stream + a replacement load that NEVER resolves: same bound, same release", async () => {
    generateImpl = (label, _input, callIndex) => {
      if (callIndex === 0) return lengthLimitedStream();
      return label === "runtime-1" ? stuckStream() : completedStream();
    };
    loadHangsForRuntimeNumber = 2;
    await mountProvider();

    expect(await ctx().sendMessage("write something long", "en")).toBe(true);
    await vi.waitFor(() => expect(ctx().canContinueGeneration).toBe(true));

    void ctx().continueGeneration();
    await vi.waitFor(() => expect(coordinator().currentOwner()).toBe("chat-continuation"));
    await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
    currentRuntime().forceError("cancel_timeout");

    await vi.waitFor(() => expect(harness.events).toContain("worker:terminate:2"), { timeout: 5_000 });
    expect(harness.events.indexOf("worker:terminate:1")).toBeLessThan(harness.events.indexOf("worker:create:2"));
    expect(harness.events.indexOf("worker:create:2")).toBeLessThan(harness.events.indexOf("worker:terminate:2"));
    expect(workers).toHaveLength(2);

    await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull(), { timeout: 5_000 });
    expect(coordinator().isQuarantined()).toBe(false);
    await vi.waitFor(() => expect(ctx().storageNotice?.key).toBe("storageNotice.runtimeRecoveryFailed"));
    const next = coordinator().tryAcquire("another-runtime-operation");
    expect(next).not.toBeNull();
    next?.release();
  });

  it("a replacement load that settles only AFTER the bound expired is inert: it cannot resurrect the torn-down replacement or start another candidate", async () => {
    generateImpl = (label) => (label === "runtime-1" ? stuckStream() : completedStream());
    loadLateForRuntimeNumber = { number: 2, afterMs: 500 };
    await mountProvider();

    void ctx().sendMessage("hello", "en");
    await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
    currentRuntime().forceError("cancel_timeout");

    await vi.waitFor(() => expect(harness.events).toContain("worker:terminate:2"), { timeout: 5_000 });
    await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull(), { timeout: 5_000 });
    await vi.waitFor(() => expect(ctx().runtimeState.status).toBe("error"));

    // Now the abandoned load finally "completes" on the torn-down runtime.
    await vi.waitFor(() => expect(lateLoadCalls).toEqual(["runtime-2"]), { timeout: 5_000 });
    await settle();
    expect(ctx().runtimeState.status).toBe("error");
    expect(ctx().runtimeState.modelId).toBeNull();
    expect(workers).toHaveLength(2);
    expect(coordinator().isQuarantined()).toBe(false);
  });

  it("a direct recoverRuntime() with a replacement that never loads returns {isolated: true, ready: false} and frees the runtime", async () => {
    loadHangsForRuntimeNumber = 2;
    await mountProvider();

    const result = await ctx().recoverRuntime();

    expect(result).toEqual({ isolated: true, ready: false });
    expect(coordinator().currentOwner()).toBeNull();
    expect(coordinator().isQuarantined()).toBe(false);
    expect(harness.events).toContain("worker:terminate:2");
    const lease = coordinator().tryAcquire("next-operation");
    expect(lease).not.toBeNull();
    lease?.release();
  });

  it("if the hung REPLACEMENT worker itself cannot be terminated, isolation is unproven: ownership is quarantined and recovery reports {isolated: false, ready: false}", async () => {
    loadHangsForRuntimeNumber = 2;
    terminateFailsForWorker = 2;
    await mountProvider();

    const result = await ctx().recoverRuntime();

    expect(result).toEqual({ isolated: false, ready: false });
    expect(coordinator().isQuarantined()).toBe(true);
    expect(coordinator().tryAcquire("normal-operation")).toBeNull();
    // And no further worker was created while the replacement may be alive.
    expect(workers).toHaveLength(2);
  });
  // The reroute that follows a stall recovery may replace the runtime AGAIN.
  // Its outcome must reach the final recovery result: a replacement that does
  // not load can never hide behind the (successful) recovery before it.
  function routeToAnotherModel(): void {
    const other = modelRegistryV2.find((record) => record.webllmModelId !== DEFAULT_MODEL_ID);
    if (!other) throw new Error("registry has no second model");
    harness.routerDecision = {
      selectedModelId: other.id,
      fallbackModelIds: [],
      reasons: [],
      warnings: [],
      rejectedModels: [],
      confidence: "medium",
      recommendedContextTokens: 4096,
      recommendedOutputTokens: 512,
    };
    harness.modelsCached = true;
  }

  it("a stall's routing replacement whose load NEVER resolves is bounded and isolated: recovery's final result is NOT ready (the earlier successful recovery cannot hide it), the lease is free", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      generateImpl = (label) => (label === "runtime-1" ? stuckStream() : completedStream());
      // runtime-1: the stuck stream, runtime-2: the recovery reload (loads),
      // runtime-3: the router's replacement (never loads).
      loadHangsForRuntimeNumber = 3;
      await mountProvider();
      routeToAnotherModel();

      void ctx().sendMessage("hello", "en");
      await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
      currentRuntime().forceError("generation_stalled");

      // The stuck stream never finishes, so recovery takes the lease over after
      // the owner-release grace and isolates under it.
      await vi.advanceTimersByTimeAsync(4_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(harness.events).toContain("worker:create:3"), { timeout: 5_000 });
      // Recovery itself succeeded (runtime-2 loaded) -- the replacement is what hangs.
      expect(harness.events.indexOf("worker:terminate:1")).toBeLessThan(harness.events.indexOf("worker:create:2"));

      // The replacement's bounded load expires: ITS worker is isolated too.
      await vi.advanceTimersByTimeAsync(300);
      await vi.waitFor(() => expect(harness.events).toContain("worker:terminate:3"), { timeout: 5_000 });
      expect(workers).toHaveLength(3);

      // The final result is not ready (the old code reported the earlier
      // recovery's ready=true) and the user is told so.
      await vi.waitFor(() => expect(ctx().storageNotice?.key).toBe("storageNotice.runtimeRecoveryFailed"), { timeout: 5_000 });
      expect(ctx().runtimeState.status).toBe("error");
      // Isolated: nothing is held or quarantined.
      await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull());
      expect(coordinator().isQuarantined()).toBe(false);
      const lease = coordinator().tryAcquire("next-operation");
      expect(lease).not.toBeNull();
      lease?.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stall's routing replacement that loads fine yields a ready final result: no failure notice, and the next chat runs on the replacement", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      generateImpl = (label) => (label === "runtime-1" ? stuckStream() : completedStream());
      await mountProvider();
      routeToAnotherModel();

      void ctx().sendMessage("hello", "en");
      await vi.waitFor(() => expect(ctx().generation.generationId).not.toBeNull());
      currentRuntime().forceError("generation_stalled");

      await vi.advanceTimersByTimeAsync(4_000);
      await vi.advanceTimersByTimeAsync(2_000);
      // recovery (runtime-2) then the routing replacement (runtime-3).
      await vi.waitFor(() => expect(harness.events).toContain("worker:create:3"), { timeout: 5_000 });
      await vi.waitFor(() => expect(ctx().runtimeState.status).toBe("ready"), { timeout: 5_000 });
      await vi.waitFor(() => expect(coordinator().currentOwner()).toBeNull());

      expect(ctx().storageNotice?.key).not.toBe("storageNotice.runtimeRecoveryFailed");
      expect(coordinator().isQuarantined()).toBe(false);
      vi.useRealTimers();
      expect(await ctx().sendMessage("after the reroute", "en")).toBe(true);
      expect(generateLog.at(-1)?.label).toBe("runtime-3");
    } finally {
      vi.useRealTimers();
    }
  });
});

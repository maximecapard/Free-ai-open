import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GenerateChunk,
  GenerateInput,
  GenerationRuntimeMetrics,
  InferenceRuntime,
  LoadModelOptions,
  ModelLoadRuntimeMetrics,
  RuntimeState,
} from "@free-ai-open/ai-runtime";
import { getRuntimeOperationCoordinator } from "@free-ai-open/ai-runtime";
import { ModelBenchmarkStoreClient } from "./client";
import { createMemoryModelBenchmarkStore } from "./memory-store";
import { createModelBenchmarkRunner } from "./runner";
import type {
  ModelBenchmarkRunnerOptions,
  ModelBenchmarkRunnerState,
} from "./runner";
import {
  getQuickBenchmarkPrompt,
  maxAutomatedBurstMs,
  PERSISTENCE_ABORT_GRACE_MS,
  PERSISTENCE_TIMEOUT_MS,
  QUICK_MODEL_BENCHMARK_PRESET,
  RUNTIME_RECOVERY_ABORT_GRACE_MS,
  RUNTIME_RECOVERY_TIMEOUT_MS,
} from "./runner-workload";
import type {
  BenchmarkEligibilityEvaluator,
  BenchmarkEligibilityResult,
  TrustedBenchmarkEnvironmentProvider,
  TrustedBenchmarkEnvironmentSnapshot,
  TrustedBenchmarkTarget,
  TrustedBenchmarkTargetResolver,
} from "./runner-trust";
import { classifyModelBenchmarkStability } from "./stability";
import { sanitizeModelBenchmarkResult } from "./validation";
import { MODEL_BENCHMARK_VERSION } from "./constants";

// isModelCached() is called directly by runner.ts (not through the injected
// InferenceRuntime), so it is the one ai-runtime export mocked here -- every
// other ai-runtime export (INSTALLED_WEBLLM_VERSION, every type) stays real.
const isModelCachedMock = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("@free-ai-open/ai-runtime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@free-ai-open/ai-runtime")>();
  return { ...actual, isModelCached: isModelCachedMock };
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Records when (and with what) a runner promise settles, so fake-timer tests
// can assert a promise has NOT settled yet at an exact instant.
function trackSettlement(promise: Promise<ModelBenchmarkRunnerState>): {
  value: ModelBenchmarkRunnerState | null;
} {
  const holder: { value: ModelBenchmarkRunnerState | null } = { value: null };
  void promise.then((state) => {
    holder.value = state;
  });
  return holder;
}

// --- Fake InferenceRuntime -------------------------------------------------
// Deliberately enforces the SAME "generate() requires status === 'ready'"
// precondition the real runtime.ts does (see its own `if (!engine ||
// state.status !== "ready")` guard) -- this is what makes the "runtime
// recovery" tests below actually meaningful: without it, calling generate()
// again after a benchmark would trivially "succeed" regardless of whether
// recovery genuinely restored a usable state.
interface FakeRuntimeHandle {
  runtime: InferenceRuntime;
  setRawState: (patch: Partial<RuntimeState>) => void;
  getRawState: () => RuntimeState;
  isStopRequested: () => boolean;
  loadModelCalls: Array<{ modelId: string; options?: LoadModelOptions }>;
  generateCalls: GenerateInput[];
  stopGenerationCallCount: () => number;
  disposeCallCount: () => number;
  loadModelImpl: (
    modelId: string,
    options?: LoadModelOptions,
  ) => Promise<ModelLoadRuntimeMetrics | null>;
  generateImpl: (input: GenerateInput) => AsyncGenerator<GenerateChunk>;
  // Invoked synchronously by the fake's stopGeneration(), in addition to
  // setting the stop flag -- lets a cooperative generateImpl awaiting a
  // promise wake up immediately, mirroring how the real runtime's
  // engine.interruptGenerate() eventually unblocks its own stream.
  onStopRequested: (() => void) | null;
}

function createFakeRuntime(
  initial: Partial<RuntimeState> = {},
): FakeRuntimeHandle {
  let state: RuntimeState = {
    status: "idle",
    modelId: null,
    loadProgress: 0,
    error: null,
    ...initial,
  };
  const listeners = new Set<(state: RuntimeState) => void>();
  let stopRequested = false;
  let stopCalls = 0;
  let disposeCalls = 0;
  const loadModelCalls: Array<{ modelId: string; options?: LoadModelOptions }> =
    [];
  const generateCalls: GenerateInput[] = [];

  const handle: FakeRuntimeHandle = {
    runtime: {
      getState: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      loadModel(modelId = "default-model", options) {
        loadModelCalls.push({ modelId, options });
        // Mirrors the real runtime.ts's own loadModel(), which sets status
        // to "loading_model" synchronously before doing anything async --
        // a configured loadModelImpl may still override this immediately.
        handle.setRawState({
          status: "loading_model",
          modelId,
          loadProgress: 0,
          error: null,
        });
        return Promise.resolve(handle.loadModelImpl(modelId, options)).then(
          (result) => {
            if (result !== null && state.status === "loading_model") {
              handle.setRawState({
                status: "ready",
                modelId,
                loadProgress: 1,
                error: null,
              });
            }
            return result;
          },
        );
      },
      generate(input) {
        generateCalls.push(input);
        if (state.status !== "ready") {
          return (async function* notReady(): AsyncGenerator<GenerateChunk> {
            yield {
              type: "error",
              error: {
                code: "unknown",
                message: "Runtime is not ready to generate.",
              },
            };
          })();
        }
        return handle.generateImpl(input);
      },
      stopGeneration() {
        stopRequested = true;
        stopCalls += 1;
        handle.onStopRequested?.();
      },
      setGenerationWatchdogSuspended() {
        // Not exercised by the benchmark runner.
      },
      async dispose() {
        disposeCalls += 1;
        state = { status: "idle", modelId: null, loadProgress: 0, error: null };
      },
    },
    setRawState(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    getRawState: () => state,
    isStopRequested: () => stopRequested,
    loadModelCalls,
    generateCalls,
    stopGenerationCallCount: () => stopCalls,
    disposeCallCount: () => disposeCalls,
    loadModelImpl: async () => {
      throw new Error("loadModelImpl not configured for this test");
    },
    generateImpl:
      async function* notConfigured(): AsyncGenerator<GenerateChunk> {
        throw new Error("generateImpl not configured for this test");
      },
    onStopRequested: null,
  };

  return handle;
}

function makeDoneMetrics(
  options: {
    inferenceStartedAt?: number;
    timeToFirstTokenMs?: number | null;
    generationDurationMs?: number;
    completionTokens?: number;
    promptTokens?: number;
    usageUnavailable?: boolean;
  } = {},
): GenerationRuntimeMetrics {
  const inferenceStartedAt = options.inferenceStartedAt ?? 0;
  const generationDurationMs = options.generationDurationMs ?? 500;
  const timeToFirstTokenMs =
    options.timeToFirstTokenMs === undefined ? 100 : options.timeToFirstTokenMs;
  const firstTokenAt =
    timeToFirstTokenMs !== null
      ? inferenceStartedAt + timeToFirstTokenMs
      : null;
  const completionTokens = options.completionTokens ?? 20;
  const promptTokens = options.promptTokens ?? 12;

  const usage: GenerationRuntimeMetrics["usage"] = options.usageUnavailable
    ? { tokenCountConfidence: "unavailable" }
    : {
        tokenCountConfidence: "exact",
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        overallCompletionTokensPerSecond:
          completionTokens / (generationDurationMs / 1000),
      };

  return {
    inferenceStartedAt,
    firstTokenAt,
    timeToFirstTokenMs,
    completedAt: inferenceStartedAt + generationDurationMs,
    generationDurationMs,
    usage,
  };
}

// --- Fake trust dependencies ------------------------------------------------

const DEFAULT_TARGET: TrustedBenchmarkTarget = {
  modelId: "quick-test-model",
  webllmModelId: "Quick-Test-Model-q4f32_1-MLC",
  registryVersion: "1.0.0",
};

const OTHER_TARGET: TrustedBenchmarkTarget = {
  modelId: "quick-test-model",
  webllmModelId: "Different-WebLLM-Id-q4f32_1-MLC",
  registryVersion: "2.0.0",
};

const DEFAULT_ENVIRONMENT: TrustedBenchmarkEnvironmentSnapshot = {
  browserFamily: "chromium",
  capabilityProfileKey: "desktop:balanced:webgpu:native",
  performanceMode: "balanced",
};

interface FakeResolver extends TrustedBenchmarkTargetResolver {
  impl: (
    modelId: string,
  ) => Promise<TrustedBenchmarkTarget | null> | TrustedBenchmarkTarget | null;
  calls: string[];
}
function createFakeResolver(
  registry: Record<string, TrustedBenchmarkTarget> = {
    [DEFAULT_TARGET.modelId]: DEFAULT_TARGET,
  },
): FakeResolver {
  const calls: string[] = [];
  const fake: FakeResolver = {
    calls,
    impl: (modelId) => registry[modelId] ?? null,
    resolve(modelId) {
      calls.push(modelId);
      return fake.impl(modelId);
    },
  };
  return fake;
}

interface FakeEnvironmentProvider extends TrustedBenchmarkEnvironmentProvider {
  impl: () =>
    | Promise<TrustedBenchmarkEnvironmentSnapshot>
    | TrustedBenchmarkEnvironmentSnapshot;
  callCount: number;
}
function createFakeEnvironmentProvider(
  snapshot: TrustedBenchmarkEnvironmentSnapshot = DEFAULT_ENVIRONMENT,
): FakeEnvironmentProvider {
  const fake: FakeEnvironmentProvider = {
    callCount: 0,
    impl: () => snapshot,
    getSnapshot() {
      fake.callCount += 1;
      return fake.impl();
    },
  };
  return fake;
}

interface FakeEligibilityEvaluator extends BenchmarkEligibilityEvaluator {
  impl: (input: {
    target: TrustedBenchmarkTarget;
    environment: TrustedBenchmarkEnvironmentSnapshot;
  }) => Promise<BenchmarkEligibilityResult> | BenchmarkEligibilityResult;
  calls: Array<{
    target: TrustedBenchmarkTarget;
    environment: TrustedBenchmarkEnvironmentSnapshot;
  }>;
}
function createFakeEligibilityEvaluator(): FakeEligibilityEvaluator {
  const calls: FakeEligibilityEvaluator["calls"] = [];
  const fake: FakeEligibilityEvaluator = {
    calls,
    impl: () => ({ eligible: true }),
    evaluate(input) {
      calls.push(input);
      return fake.impl(input);
    },
  };
  return fake;
}

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

function createTestRunner(
  fake: FakeRuntimeHandle,
  overrides: Partial<ModelBenchmarkRunnerOptions> = {},
) {
  const store = new ModelBenchmarkStoreClient({
    store: createMemoryModelBenchmarkStore(),
  });
  const resolver =
    (overrides.targetResolver as FakeResolver | undefined) ??
    createFakeResolver();
  const environmentProvider =
    (overrides.environmentProvider as FakeEnvironmentProvider | undefined) ??
    createFakeEnvironmentProvider();
  const eligibilityEvaluator =
    (overrides.eligibilityEvaluator as FakeEligibilityEvaluator | undefined) ??
    createFakeEligibilityEvaluator();
  const recoverRuntime =
    overrides.recoverRuntime ??
    vi.fn(async () => {
      fake.setRawState({ status: "ready", error: null });
      return { isolated: true, ready: true };
    });
  const runner = createModelBenchmarkRunner({
    runtime: fake.runtime,
    targetResolver: resolver,
    environmentProvider,
    eligibilityEvaluator,
    recoverRuntime,
    store,
    now: overrides.now ?? FIXED_NOW,
    inspectModelCache: overrides.inspectModelCache,
    automatedBudgetMs: overrides.automatedBudgetMs,
  });
  return {
    runner,
    store,
    resolver,
    environmentProvider,
    eligibilityEvaluator,
    recoverRuntime,
  };
}

function expectStatus<S extends ModelBenchmarkRunnerState["status"]>(
  state: ModelBenchmarkRunnerState,
  status: S,
): Extract<ModelBenchmarkRunnerState, { status: S }> {
  if (state.status !== status) {
    const detail =
      state.status === "failed"
        ? ` (error: ${state.error.code} -- ${state.error.message})`
        : "";
    throw new Error(
      `expected status "${status}", got "${state.status}"${detail}`,
    );
  }
  return state as Extract<ModelBenchmarkRunnerState, { status: S }>;
}

async function waitForStatus(
  runner: { getState(): ModelBenchmarkRunnerState },
  status: ModelBenchmarkRunnerState["status"],
): Promise<void> {
  await vi.waitFor(
    () => {
      if (runner.getState().status !== status) {
        throw new Error(
          `expected status "${status}", got "${runner.getState().status}"`,
        );
      }
    },
    { timeout: 2000, interval: 5 },
  );
}

// Every load -- even of an already-cached model -- requires explicit
// consent (see the "consent" describe block below). Tests that only care
// about what happens DURING/AFTER a load use this helper to get past that
// gate without re-asserting it themselves each time.
async function startAndConfirmConsent(
  runner: {
    start: (options: { modelId: string }) => Promise<ModelBenchmarkRunnerState>;
    confirmConsent: (id: string) => Promise<ModelBenchmarkRunnerState>;
  },
  modelId: string,
): Promise<ModelBenchmarkRunnerState> {
  const result = await runner.start({ modelId });
  if (result.status !== "requires_model_load_consent") return result;
  return runner.confirmConsent(result.consentRequestId);
}

function naturalCompletion(fake: FakeRuntimeHandle): void {
  fake.generateImpl =
    async function* completed(): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      yield { type: "done", reason: "completed", metrics: makeDoneMetrics() };
    };
}

beforeEach(() => {
  isModelCachedMock.mockReset();
  isModelCachedMock.mockResolvedValue(false);
});

describe("createModelBenchmarkRunner -- trust", () => {
  it("rejects an unknown model id without ever calling loadModel()/generate()", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    const { runner } = createTestRunner(fake, {
      targetResolver: createFakeResolver({}),
    });

    const result = await runner.start({ modelId: "no-such-model" });

    const failed = expectStatus(result, "failed");
    expect(failed.error.code).toBe("unknown_model");
    expect(fake.loadModelCalls).toHaveLength(0);
    expect(fake.generateCalls).toHaveLength(0);
  });

  it("never lets a caller-forged webllmModelId/registryVersion/quantization override the trusted resolver's record", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(true);
    fake.loadModelImpl = async () => ({ loadTimeMs: 500 });
    naturalCompletion(fake);
    // The runner's public start() input is a bare modelId string -- there is
    // no field on ModelBenchmarkRunOptions a caller could even attempt to
    // set a forged webllmModelId/fingerprint through. This test proves the
    // ACTUAL loadModel() call and persisted record use only the resolver's
    // own trusted values.
    const { runner, store } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });
    const requiresConsent = expectStatus(result, "requires_model_load_consent");
    const completed = expectStatus(
      await runner.confirmConsent(requiresConsent.consentRequestId),
      "completed",
    );

    expect(fake.loadModelCalls[0]?.modelId).toBe(DEFAULT_TARGET.webllmModelId);
    expect(completed.result.model).toEqual(DEFAULT_TARGET);
    const [stored] = await store.listResults();
    expect(stored?.model).toEqual(DEFAULT_TARGET);
  });

  it("resolves through the injected resolver by modelId, never a caller-supplied registry object", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const resolver = createFakeResolver();
    const { runner } = createTestRunner(fake, { targetResolver: resolver });

    await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expect(resolver.calls).toEqual([DEFAULT_TARGET.modelId]);
  });

  it.each([
    ["mismatched model id", { ...DEFAULT_TARGET, modelId: "different-model" }],
    [
      "malformed WebLLM id",
      { ...DEFAULT_TARGET, webllmModelId: "https://invalid.example/model" },
    ],
    [
      "invalid registry version",
      { ...DEFAULT_TARGET, registryVersion: "not a version" },
    ],
    ["invalid quantization", { ...DEFAULT_TARGET, quantization: "bad value" }],
    [
      "invalid verification version",
      { ...DEFAULT_TARGET, verifiedWithWebLLMVersion: "latest" },
    ],
  ])(
    "rejects resolver output with %s before any runtime operation",
    async (_label, malformed) => {
      const fake = createFakeRuntime({ status: "idle" });
      const resolver = createFakeResolver();
      resolver.impl = () => malformed as TrustedBenchmarkTarget;
      const { runner } = createTestRunner(fake, { targetResolver: resolver });

      const failed = expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "failed",
      );

      expect(failed.error.code).toBe("target_resolver_failed");
      expect(fake.loadModelCalls).toHaveLength(0);
      expect(fake.generateCalls).toHaveLength(0);
    },
  );

  it.each([
    ["browser family", { ...DEFAULT_ENVIRONMENT, browserFamily: "netscape" }],
    [
      "capability key",
      { ...DEFAULT_ENVIRONMENT, capabilityProfileKey: "device-uuid-123" },
    ],
    ["performance mode", { ...DEFAULT_ENVIRONMENT, performanceMode: "turbo" }],
    [
      "app version",
      { ...DEFAULT_ENVIRONMENT, appVersion: "unbounded version value" },
    ],
  ])(
    "rejects an invalid trusted environment %s before any runtime operation",
    async (_label, malformed) => {
      const fake = createFakeRuntime({ status: "idle" });
      const environmentProvider = createFakeEnvironmentProvider();
      environmentProvider.impl = () =>
        malformed as TrustedBenchmarkEnvironmentSnapshot;
      const { runner } = createTestRunner(fake, { environmentProvider });

      const failed = expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "failed",
      );

      expect(failed.error.code).toBe("environment_provider_failed");
      expect(fake.loadModelCalls).toHaveLength(0);
      expect(fake.generateCalls).toHaveLength(0);
    },
  );
});

describe("createModelBenchmarkRunner -- eligibility", () => {
  it("rejects an ineligible model before consent/cache/load -- loadModel() is never called", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    const eligibilityEvaluator = createFakeEligibilityEvaluator();
    eligibilityEvaluator.impl = () => ({
      eligible: false,
      reasonCode: "webgpu_unavailable",
      message: "WebGPU is not available.",
    });
    const { runner } = createTestRunner(fake, { eligibilityEvaluator });

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const failed = expectStatus(result, "failed");
    expect(failed.error.code).toBe("ineligible_model");
    expect(fake.loadModelCalls).toHaveLength(0);
    expect(isModelCachedMock).not.toHaveBeenCalled();
  });

  it("evaluates eligibility with the trusted target and environment, never a caller-suppliable shape", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const eligibilityEvaluator = createFakeEligibilityEvaluator();
    const { runner } = createTestRunner(fake, { eligibilityEvaluator });

    await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expect(eligibilityEvaluator.calls).toEqual([
      { target: DEFAULT_TARGET, environment: DEFAULT_ENVIRONMENT },
    ]);
  });

  it("refuses to start while the shared runtime is busy with normal chat generation", async () => {
    const fake = createFakeRuntime({
      status: "generating",
      modelId: "some-other-model",
    });
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const failed = expectStatus(result, "failed");
    expect(failed.error.code).toBe("runtime_busy");
    expect(isModelCachedMock).not.toHaveBeenCalled();
  });
});

describe("createModelBenchmarkRunner -- consent", () => {
  it("requires consent for ANY load, even an already-cached model -- cache status is informational only, never a security boundary", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(true); // cached, but not currently loaded
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expectStatus(result, "requires_model_load_consent");
    expect(fake.loadModelCalls).toHaveLength(0);
  });

  it("never requires consent when the exact target model is already loaded and ready", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expectStatus(result, "completed");
    expect(fake.loadModelCalls).toHaveLength(0);
  });

  it("proceeds to load only once confirmConsent() is called with the matching consentRequestId", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(false);
    fake.loadModelImpl = async () => ({ loadTimeMs: 4000 });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const requiresConsent = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "requires_model_load_consent",
    );
    expect(fake.loadModelCalls).toHaveLength(0);
    const result = await runner.confirmConsent(
      requiresConsent.consentRequestId,
    );

    expectStatus(result, "completed");
    expect(fake.loadModelCalls).toHaveLength(1);
  });

  it("rejects a stale/forged consentRequestId without starting a load and without mutating the active run", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(false);
    const { runner } = createTestRunner(fake);

    await runner.start({ modelId: DEFAULT_TARGET.modelId });
    const rejection = await runner.confirmConsent("forged-id");

    const failed = expectStatus(rejection, "failed");
    expect(failed.error.code).toBe("invalid_consent");
    expect(fake.loadModelCalls).toHaveLength(0);
    // The real, active run's own visible state must be untouched.
    expectStatus(runner.getState(), "requires_model_load_consent");
  });

  it("consent for run A can never authorize run B for a different model", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(false);
    const { runner } = createTestRunner(fake, {
      targetResolver: createFakeResolver({
        [DEFAULT_TARGET.modelId]: DEFAULT_TARGET,
        "model-b": { ...DEFAULT_TARGET, modelId: "model-b" },
      }),
    });

    const consentA = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "requires_model_load_consent",
    );
    runner.cancel(); // abandon A, still holding its old consentRequestId
    const rejection = await runner.confirmConsent(consentA.consentRequestId);

    const failed = expectStatus(rejection, "failed");
    expect(failed.error.code).toBe("invalid_consent");
  });

  it("a single-use consent id cannot be confirmed twice", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(false);
    fake.loadModelImpl = async () => ({ loadTimeMs: 1000 });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const requiresConsent = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "requires_model_load_consent",
    );
    expectStatus(
      await runner.confirmConsent(requiresConsent.consentRequestId),
      "completed",
    );
    const second = await runner.confirmConsent(
      requiresConsent.consentRequestId,
    );

    expect(second.status).toBe("failed");
    if (second.status === "failed")
      expect(second.error.code).toBe("invalid_consent");
  });

  it("invalidates consent when the resolved model's fingerprint/version changed since it was requested", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(false);
    const resolver = createFakeResolver({
      [DEFAULT_TARGET.modelId]: DEFAULT_TARGET,
    });
    const { runner } = createTestRunner(fake, { targetResolver: resolver });

    const requiresConsent = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "requires_model_load_consent",
    );
    // The registry entry changes (e.g. a re-verification bumped its
    // registryVersion/webllmModelId) between requesting and confirming.
    resolver.impl = () => OTHER_TARGET;
    const result = await runner.confirmConsent(
      requiresConsent.consentRequestId,
    );

    const failed = expectStatus(result, "failed");
    expect(failed.error.code).toBe("consent_stale");
    expect(fake.loadModelCalls).toHaveLength(0);
  });

  it("cancelling while parked at requires_model_load_consent invalidates that request and never persists anything", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(false);
    const { runner, store } = createTestRunner(fake);

    const requiresConsent = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "requires_model_load_consent",
    );
    runner.cancel();
    expectStatus(runner.getState(), "idle");

    const rejection = await runner.confirmConsent(
      requiresConsent.consentRequestId,
    );
    expectStatus(rejection, "failed");
    expect(await store.listResults()).toHaveLength(0);
  });
});

describe("createModelBenchmarkRunner -- lifecycle / concurrency", () => {
  it("refuses a second concurrent start() without mutating the first (active) run's own visible state", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(true);
    const loadDeferred = createDeferred<ModelLoadRuntimeMetrics | null>();
    fake.loadModelImpl = () => loadDeferred.promise;
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const consent = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "requires_model_load_consent",
    );
    const firstPromise = runner.confirmConsent(consent.consentRequestId);
    await waitForStatus(runner, "loading");

    const second = await runner.start({ modelId: DEFAULT_TARGET.modelId });
    const secondFailed = expectStatus(second, "failed");
    expect(secondFailed.error.code).toBe("benchmark_already_running");
    // Run A's own visible state must be completely untouched by the doomed
    // second call -- this is the exact bug class the mission's "second
    // start must not mutate run A" requirement targets.
    expectStatus(runner.getState(), "loading");

    loadDeferred.resolve({ loadTimeMs: 1000 });
    expectStatus(await firstPromise, "completed");
  });

  it("keeps a timed-out load isolated until recovery reconciles the runtime and releases ownership", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({ status: "idle" });
      isModelCachedMock.mockResolvedValue(true);
      fake.loadModelImpl = () => new Promise(() => {}); // never resolves
      naturalCompletion(fake);
      const { runner } = createTestRunner(fake);

      const consent = expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "requires_model_load_consent",
      );
      const firstPromise = runner.confirmConsent(consent.consentRequestId);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_100);
      const first = await firstPromise;
      expectStatus(first, "completed");

      // The required recovery adapter reconciled the shared runtime before
      // the runner released its lease.
      expect(fake.getRawState().status).toBe("ready");
      const second = await runner.start({ modelId: DEFAULT_TARGET.modelId });
      expectStatus(second, "completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelling while checking (before any load decision) resolves to idle without persisting anything", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    const resolver = createFakeResolver();
    const resolveDeferred = createDeferred<TrustedBenchmarkTarget | null>();
    resolver.impl = () => resolveDeferred.promise;
    const { runner, store } = createTestRunner(fake, {
      targetResolver: resolver,
    });

    const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await waitForStatus(runner, "checking");
    runner.cancel();
    expectStatus(runner.getState(), "cancelling");
    resolveDeferred.resolve(DEFAULT_TARGET);
    const result = await startPromise;

    expectStatus(result, "idle");
    expect(await store.listResults()).toHaveLength(0);
  });

  it("cancelling during loading persists a loading_model/cancelled result once the load settles", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(true);
    const loadDeferred = createDeferred<ModelLoadRuntimeMetrics | null>();
    fake.loadModelImpl = () => loadDeferred.promise;
    const { runner, store } = createTestRunner(fake);

    const consent = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "requires_model_load_consent",
    );
    const startPromise = runner.confirmConsent(consent.consentRequestId);
    await waitForStatus(runner, "loading");
    runner.cancel();
    expectStatus(runner.getState(), "cancelling");
    loadDeferred.resolve({ loadTimeMs: 3000 });
    const result = await startPromise;

    const completed = expectStatus(result, "completed");
    expect(completed.result.stage).toBe("loading_model");
    expect(completed.result.outcome).toBe("cancelled");
    expect(completed.result.load).toEqual({
      wasModelCachedBeforeRun: true,
      modelLoadedDuringRun: true,
      loadTimeMs: 3000,
    });
    expect(await store.listResults()).toHaveLength(1);
  });

  it("cancelling before any token arrives persists an awaiting_first_token/cancelled result", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      fake.setRawState({ status: "generating" });
      await new Promise<void>((resolve) => {
        fake.onStopRequested = resolve;
      });
      fake.setRawState({ status: "cancelling" });
      yield {
        type: "done",
        reason: "cancelled",
        metrics: makeDoneMetrics({
          timeToFirstTokenMs: null,
          usageUnavailable: true,
        }),
      };
    };
    const { runner } = createTestRunner(fake);

    const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await waitForStatus(runner, "running");
    runner.cancel();
    const result = await startPromise;

    const completed = expectStatus(result, "completed");
    expect(completed.result.stage).toBe("awaiting_first_token");
    expect(completed.result.outcome).toBe("cancelled");
    expect(completed.result.firstToken).toEqual({});
  });

  it("cancelling after some tokens have streamed persists a generating/cancelled result", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      fake.setRawState({ status: "generating" });
      yield { type: "token", text: "a" };
      await new Promise<void>((resolve) => {
        fake.onStopRequested = resolve;
      });
      fake.setRawState({ status: "cancelling" });
      yield {
        type: "done",
        reason: "cancelled",
        metrics: makeDoneMetrics({
          timeToFirstTokenMs: 40,
          usageUnavailable: true,
        }),
      };
    };
    const { runner } = createTestRunner(fake);

    const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await vi.waitFor(() => {
      if (fake.generateCalls.length === 0)
        throw new Error("not yet generating");
    });
    await sleep(5);
    runner.cancel();
    const result = await startPromise;

    const completed = expectStatus(result, "completed");
    expect(completed.result.stage).toBe("generating");
    expect(completed.result.outcome).toBe("cancelled");
    expect(completed.result.firstToken).toEqual({ firstTokenTimeMs: 40 });
  });
});

describe("createModelBenchmarkRunner -- safe async adapters", () => {
  it.each([
    [
      "synchronous throw",
      () => {
        throw new Error("resolver sync failure");
      },
    ],
    [
      "rejected promise",
      () => Promise.reject(new Error("resolver async failure")),
    ],
  ])(
    "contains a resolver %s and permits a new attempt",
    async (_label, failure) => {
      const fake = createFakeRuntime({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
      });
      naturalCompletion(fake);
      const resolver = createFakeResolver();
      resolver.impl = failure as FakeResolver["impl"];
      const { runner } = createTestRunner(fake, { targetResolver: resolver });

      expect(
        expectStatus(
          await runner.start({ modelId: DEFAULT_TARGET.modelId }),
          "failed",
        ).error.code,
      ).toBe("target_resolver_failed");
      resolver.impl = () => DEFAULT_TARGET;
      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "completed",
      );
    },
  );

  it.each([
    [
      "synchronous throw",
      () => {
        throw new Error("environment sync failure");
      },
    ],
    [
      "rejected promise",
      () => Promise.reject(new Error("environment async failure")),
    ],
  ])(
    "contains an environment-provider %s and permits a new attempt",
    async (_label, failure) => {
      const fake = createFakeRuntime({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
      });
      naturalCompletion(fake);
      const provider = createFakeEnvironmentProvider();
      provider.impl = failure as FakeEnvironmentProvider["impl"];
      const { runner } = createTestRunner(fake, {
        environmentProvider: provider,
      });

      expect(
        expectStatus(
          await runner.start({ modelId: DEFAULT_TARGET.modelId }),
          "failed",
        ).error.code,
      ).toBe("environment_provider_failed");
      provider.impl = () => DEFAULT_ENVIRONMENT;
      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "completed",
      );
    },
  );

  it.each([
    [
      "synchronous throw",
      () => {
        throw new Error("eligibility sync failure");
      },
    ],
    [
      "rejected promise",
      () => Promise.reject(new Error("eligibility async failure")),
    ],
  ])(
    "contains an eligibility-evaluator %s and permits a new attempt",
    async (_label, failure) => {
      const fake = createFakeRuntime({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
      });
      naturalCompletion(fake);
      const evaluator = createFakeEligibilityEvaluator();
      evaluator.impl = failure as FakeEligibilityEvaluator["impl"];
      const { runner } = createTestRunner(fake, {
        eligibilityEvaluator: evaluator,
      });

      expect(
        expectStatus(
          await runner.start({ modelId: DEFAULT_TARGET.modelId }),
          "failed",
        ).error.code,
      ).toBe("eligibility_failed");
      evaluator.impl = () => ({ eligible: true });
      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "completed",
      );
    },
  );

  it("ignores a late environment snapshot after cancellation and does not remain busy", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const deferred = createDeferred<TrustedBenchmarkEnvironmentSnapshot>();
    const provider = createFakeEnvironmentProvider();
    provider.impl = () => deferred.promise;
    const { runner } = createTestRunner(fake, {
      environmentProvider: provider,
    });

    const first = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await vi.waitFor(() => expect(provider.callCount).toBe(1));
    runner.cancel();
    deferred.resolve(DEFAULT_ENVIRONMENT);
    expectStatus(await first, "idle");
    provider.impl = () => DEFAULT_ENVIRONMENT;
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });

  it("ignores a late eligibility result after cancellation and does not remain busy", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const deferred = createDeferred<BenchmarkEligibilityResult>();
    const evaluator = createFakeEligibilityEvaluator();
    evaluator.impl = () => deferred.promise;
    const { runner } = createTestRunner(fake, {
      eligibilityEvaluator: evaluator,
    });

    const first = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await vi.waitFor(() => expect(evaluator.calls).toHaveLength(1));
    runner.cancel();
    deferred.resolve({ eligible: true });
    expectStatus(await first, "idle");
    evaluator.impl = () => ({ eligible: true });
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });

  it("ignores a late cache inspection after cancellation and does not remain busy", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const deferred = createDeferred<boolean>();
    let cacheCalls = 0;
    const inspectModelCache = () => {
      cacheCalls += 1;
      return cacheCalls === 1 ? deferred.promise : Promise.resolve(true);
    };
    const { runner } = createTestRunner(fake, { inspectModelCache });

    const first = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await vi.waitFor(() => expect(cacheCalls).toBe(1));
    runner.cancel();
    deferred.resolve(true);
    expectStatus(await first, "idle");
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });
});

describe("createModelBenchmarkRunner -- shared runtime ownership", () => {
  it("lets chat win during trust checks and then refuses benchmark runtime work", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const resolver = createFakeResolver();
    const deferred = createDeferred<TrustedBenchmarkTarget | null>();
    resolver.impl = () => deferred.promise;
    const { runner } = createTestRunner(fake, { targetResolver: resolver });

    const runPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await waitForStatus(runner, "checking");
    const operations = getRuntimeOperationCoordinator(fake.runtime);
    const chatLease = operations.tryAcquire("chat-generation");
    expect(chatLease).not.toBeNull();
    deferred.resolve(DEFAULT_TARGET);

    const failed = expectStatus(await runPromise, "failed");
    expect(failed.error.code).toBe("runtime_busy");
    expect(fake.loadModelCalls).toHaveLength(0);
    expect(fake.generateCalls).toHaveLength(0);
    chatLease?.release();
  });

  it("blocks chat while the benchmark owns the runtime and releases after success", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    const finish = createDeferred<void>();
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      await finish.promise;
      yield { type: "done", reason: "completed", metrics: makeDoneMetrics() };
    };
    const { runner } = createTestRunner(fake);
    const operations = getRuntimeOperationCoordinator(fake.runtime);

    const runPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await waitForStatus(runner, "running");
    expect(operations.tryAcquire("chat-generation")).toBeNull();

    finish.resolve();
    expectStatus(await runPromise, "completed");
    const chatLease = operations.tryAcquire("chat-generation");
    expect(chatLease).not.toBeNull();
    chatLease?.release();
  });

  it("releases ownership after cancellation", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      fake.setRawState({ status: "generating" });
      await new Promise<void>((resolve) => {
        fake.onStopRequested = resolve;
      });
      fake.setRawState({ status: "cancelling" });
      yield {
        type: "done",
        reason: "cancelled",
        metrics: makeDoneMetrics({
          timeToFirstTokenMs: null,
          usageUnavailable: true,
        }),
      };
    };
    const { runner } = createTestRunner(fake);
    const operations = getRuntimeOperationCoordinator(fake.runtime);

    const runPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await waitForStatus(runner, "running");
    runner.cancel();
    expectStatus(await runPromise, "completed");
    const chatLease = operations.tryAcquire("chat-generation");
    expect(chatLease).not.toBeNull();
    chatLease?.release();
  });
});

describe("createModelBenchmarkRunner -- genuine failures vs runner policy timeouts", () => {
  it("classifies a genuine ai-runtime-reported stall as negative 'stalled', never a policy timeout", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      yield {
        type: "error",
        error: { code: "generation_stalled", message: "no progress" },
      };
    };
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const completed = expectStatus(result, "completed");
    expect(completed.result.outcome).toBe("stalled");
  });

  it("maps token then silent iterator completion to neutral terminal_unknown", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "partial" };
    };
    const { runner } = createTestRunner(fake);

    const completed = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );

    expect(completed.result.stage).toBe("generating");
    expect(completed.result.outcome).toBe("terminal_unknown");
  });

  it("maps a generic stream rejection after output to neutral terminal_unknown, never stalled", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "partial" };
      throw new Error("generic runtime failure");
    };
    const { runner } = createTestRunner(fake);

    const completed = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );

    expect(completed.result.stage).toBe("generating");
    expect(completed.result.outcome).toBe("terminal_unknown");
  });

  it("classifies ai-runtime's own internal safety-limit/cancel-confirmation limits as neutral 'benchmark_timeout', never model instability", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      yield {
        type: "error",
        error: {
          code: "generation_exceeded_safety_limit",
          message: "too long",
        },
      };
    };
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const completed = expectStatus(result, "completed");
    expect(completed.result.outcome).toBe("benchmark_timeout");
  });

  it("classifies a genuine load failure (webgpu unavailable) as negative 'load_failed'", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(true);
    fake.loadModelImpl = async () => {
      fake.setRawState({
        status: "error",
        error: { code: "webgpu_unavailable", message: "no gpu" },
      });
      return null;
    };
    const { runner } = createTestRunner(fake);

    const result = await startAndConfirmConsent(runner, DEFAULT_TARGET.modelId);

    const completed = expectStatus(result, "completed");
    expect(completed.result.stage).toBe("loading_model");
    expect(completed.result.outcome).toBe("load_failed");
  });

  it("classifies an out-of-memory load failure as negative 'out_of_memory'", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    isModelCachedMock.mockResolvedValue(true);
    fake.loadModelImpl = async () => {
      fake.setRawState({
        status: "error",
        error: { code: "out_of_memory", message: "device lost" },
      });
      return null;
    };
    const { runner } = createTestRunner(fake);

    const result = await startAndConfirmConsent(runner, DEFAULT_TARGET.modelId);
    expect(expectStatus(result, "completed").result.outcome).toBe(
      "out_of_memory",
    );
  });

  it("a healthy model producing steady progress right up to the runner's own absolute deadline is classified 'benchmark_timeout', never 'stalled'", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
      });
      fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
        const stopPromise = new Promise<void>((resolve) => {
          fake.onStopRequested = resolve;
        });
        for (let i = 0; i < 5; i += 1) {
          await sleep(10_000);
          yield { type: "token", text: "a" };
        }
        await stopPromise;
        yield {
          type: "done",
          reason: "cancelled",
          metrics: makeDoneMetrics({
            timeToFirstTokenMs: 10_000,
            usageUnavailable: true,
          }),
        };
      };
      const { runner } = createTestRunner(fake);

      const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_100);
      const result = await startPromise;

      const completed = expectStatus(result, "completed");
      expect(completed.result.stage).toBe("generating");
      expect(completed.result.outcome).toBe("benchmark_timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reinterprets the benchmark's own first-token timeout as neutral 'benchmark_timeout'", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
      });
      fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
        await new Promise<void>((resolve) => {
          fake.onStopRequested = resolve;
        });
        yield {
          type: "done",
          reason: "cancelled",
          metrics: makeDoneMetrics({
            timeToFirstTokenMs: null,
            usageUnavailable: true,
          }),
        };
      };
      const { runner } = createTestRunner(fake);

      const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await startPromise;

      const completed = expectStatus(result, "completed");
      expect(completed.result.stage).toBe("awaiting_first_token");
      expect(completed.result.outcome).toBe("benchmark_timeout");
      expect(fake.stopGenerationCallCount()).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a load that never settles within the load timeout as neutral 'load_timeout', not 'load_failed'", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({ status: "idle" });
      isModelCachedMock.mockResolvedValue(true);
      fake.loadModelImpl = () => new Promise(() => {});
      const { runner } = createTestRunner(fake);

      const consent = expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "requires_model_load_consent",
      );
      const startPromise = runner.confirmConsent(consent.consentRequestId);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_100);
      const result = await startPromise;

      const completed = expectStatus(result, "completed");
      expect(completed.result.stage).toBe("loading_model");
      expect(completed.result.outcome).toBe("load_timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a truly wedged generation after the teardown grace period and finalizes as 'benchmark_timeout'", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
      });
      fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
        yield { type: "token", text: "a" };
        await new Promise<void>(() => {
          // Never resolves, and never reacts to stopGeneration().
        });
      };
      const { runner, recoverRuntime } = createTestRunner(fake);

      const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(80_100); // absoluteBenchmarkTimeoutMs (60s) + teardown grace (20s)
      const result = await startPromise;

      const completed = expectStatus(result, "completed");
      // The abandoned stream is isolated by recovery even though the fake
      // runtime's own status still reads "ready".
      expect(recoverRuntime).toHaveBeenCalledTimes(1);
      expect(completed.result.stage).toBe("generating");
      expect(completed.result.outcome).toBe("benchmark_timeout");
      expect(completed.result.generation).toEqual({
        tokenCountConfidence: "unavailable",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createModelBenchmarkRunner -- output configuration", () => {
  it("requests exactly the persisted requestedOutputTokens from the runtime -- never a different, larger ceiling", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const completed = expectStatus(result, "completed");
    expect(fake.generateCalls[0]?.maxOutputTokens).toBe(
      QUICK_MODEL_BENCHMARK_PRESET.outputTokens,
    );
    expect(completed.result.runConfig.requestedOutputTokens).toBe(
      QUICK_MODEL_BENCHMARK_PRESET.outputTokens,
    );
    expect(fake.generateCalls[0]?.maxOutputTokens).toBe(
      completed.result.runConfig.requestedOutputTokens,
    );
  });
});

describe("createModelBenchmarkRunner -- one deadline per automated burst", () => {
  function installDelayedChecks(
    resolver: FakeResolver,
    environmentProvider: FakeEnvironmentProvider,
    eligibilityEvaluator: FakeEligibilityEvaluator,
  ): () => Promise<boolean> {
    resolver.impl = async () => {
      await sleep(15);
      return DEFAULT_TARGET;
    };
    environmentProvider.impl = async () => {
      await sleep(15);
      return DEFAULT_ENVIRONMENT;
    };
    eligibilityEvaluator.impl = async () => {
      await sleep(15);
      return { eligible: true };
    };
    return async () => {
      await sleep(15);
      return true;
    };
  }

  it("does not reset the no-consent budget between checks, generation, and persistence", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
      });
      fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
        await new Promise<void>((resolve) => {
          fake.onStopRequested = resolve;
        });
        yield {
          type: "done",
          reason: "cancelled",
          metrics: makeDoneMetrics({
            timeToFirstTokenMs: null,
            usageUnavailable: true,
          }),
        };
      };
      const resolver = createFakeResolver();
      const environmentProvider = createFakeEnvironmentProvider();
      const eligibilityEvaluator = createFakeEligibilityEvaluator();
      const inspectModelCache = installDelayedChecks(
        resolver,
        environmentProvider,
        eligibilityEvaluator,
      );
      const { runner } = createTestRunner(fake, {
        targetResolver: resolver,
        environmentProvider,
        eligibilityEvaluator,
        inspectModelCache,
        automatedBudgetMs: 100,
      });

      const resultPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(101);
      const failed = expectStatus(await resultPromise, "failed");

      expect(fake.generateCalls).toHaveLength(1);
      expect(failed.error.code).toBe("persistence_failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts one fresh budget after consent and excludes human waiting time", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({ status: "idle" });
      fake.loadModelImpl = async () => ({ loadTimeMs: 1 });
      fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
        await new Promise<void>((resolve) => {
          fake.onStopRequested = resolve;
        });
        yield {
          type: "done",
          reason: "cancelled",
          metrics: makeDoneMetrics({
            timeToFirstTokenMs: null,
            usageUnavailable: true,
          }),
        };
      };
      const resolver = createFakeResolver();
      const environmentProvider = createFakeEnvironmentProvider();
      const eligibilityEvaluator = createFakeEligibilityEvaluator();
      const inspectModelCache = installDelayedChecks(
        resolver,
        environmentProvider,
        eligibilityEvaluator,
      );
      const { runner } = createTestRunner(fake, {
        targetResolver: resolver,
        environmentProvider,
        eligibilityEvaluator,
        inspectModelCache,
        automatedBudgetMs: 100,
      });

      const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(61);
      const consent = expectStatus(
        await startPromise,
        "requires_model_load_consent",
      );
      await vi.advanceTimersByTimeAsync(1_000);

      const confirmPromise = runner.confirmConsent(consent.consentRequestId);
      await vi.advanceTimersByTimeAsync(101);
      const failed = expectStatus(await confirmPromise, "failed");

      expect(fake.loadModelCalls).toHaveLength(1);
      expect(fake.generateCalls).toHaveLength(1);
      expect(failed.error.code).toBe("persistence_failed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createModelBenchmarkRunner -- persistence", () => {
  it("persists a result that independently passes sanitizeModelBenchmarkResult()", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner, store } = createTestRunner(fake);

    await runner.start({ modelId: DEFAULT_TARGET.modelId });
    const [stored] = await store.listResults();

    expect(stored).toBeDefined();
    expect(sanitizeModelBenchmarkResult(stored)).toEqual(stored);
  });

  it("stamps the CURRENT MODEL_BENCHMARK_VERSION, never a stale pre-Phase-2 one", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const completed = expectStatus(result, "completed");
    expect(completed.result.benchmarkVersion).toBe(MODEL_BENCHMARK_VERSION);
    expect(completed.result.benchmarkVersion).not.toBe("1.0.0");
  });

  it("reports persistence_failed (not completed) when the store refuses to record the result", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const store = new ModelBenchmarkStoreClient({
      store: createMemoryModelBenchmarkStore(),
    });
    const recordSpy = vi.spyOn(store, "recordResult").mockResolvedValue(false);
    const runner = createModelBenchmarkRunner({
      runtime: fake.runtime,
      targetResolver: createFakeResolver(),
      environmentProvider: createFakeEnvironmentProvider(),
      eligibilityEvaluator: createFakeEligibilityEvaluator(),
      recoverRuntime: vi.fn(async () => ({ isolated: true, ready: true })),
      store,
      now: FIXED_NOW,
    });

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const failed = expectStatus(result, "failed");
    expect(failed.error.code).toBe("persistence_failed");
    recordSpy.mockRestore();
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });

  it("reports persistence_failed when the store throws, rather than propagating the exception", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const store = new ModelBenchmarkStoreClient({
      store: createMemoryModelBenchmarkStore(),
    });
    const recordSpy = vi
      .spyOn(store, "recordResult")
      .mockRejectedValue(new Error("disk full"));
    const runner = createModelBenchmarkRunner({
      runtime: fake.runtime,
      targetResolver: createFakeResolver(),
      environmentProvider: createFakeEnvironmentProvider(),
      eligibilityEvaluator: createFakeEligibilityEvaluator(),
      recoverRuntime: vi.fn(async () => ({ isolated: true, ready: true })),
      store,
      now: FIXED_NOW,
    });

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });
    expect(expectStatus(result, "failed").error.code).toBe(
      "persistence_failed",
    );
    recordSpy.mockRestore();
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });

  it("contains a synchronous storage throw and permits a new attempt", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const store = new ModelBenchmarkStoreClient({
      store: createMemoryModelBenchmarkStore(),
    });
    const recordSpy = vi.spyOn(store, "recordResult").mockImplementation(() => {
      throw new Error("synchronous storage failure");
    });
    const runner = createModelBenchmarkRunner({
      runtime: fake.runtime,
      targetResolver: createFakeResolver(),
      environmentProvider: createFakeEnvironmentProvider(),
      eligibilityEvaluator: createFakeEligibilityEvaluator(),
      recoverRuntime: vi.fn(async () => ({ isolated: true, ready: true })),
      store,
      now: FIXED_NOW,
    });

    expect(
      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "failed",
      ).error.code,
    ).toBe("persistence_failed");
    recordSpy.mockRestore();
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });

  it("waits for abortable persistence to become quiescent before failing or accepting run B", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
      });
      naturalCompletion(fake);
      const store = new ModelBenchmarkStoreClient({
        store: createMemoryModelBenchmarkStore(),
      });
      const realRecord = store.recordResult.bind(store);
      let quiescent = false;
      let calls = 0;
      vi.spyOn(store, "recordResult").mockImplementation((result, options) => {
        calls += 1;
        if (calls > 1) return realRecord(result, options);
        return new Promise<boolean>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              setTimeout(() => {
                quiescent = true;
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              }, 100);
            },
            { once: true },
          );
        });
      });
      const runner = createModelBenchmarkRunner({
        runtime: fake.runtime,
        targetResolver: createFakeResolver(),
        environmentProvider: createFakeEnvironmentProvider(),
        eligibilityEvaluator: createFakeEligibilityEvaluator(),
        recoverRuntime: vi.fn(async () => ({ isolated: true, ready: true })),
        store,
        now: FIXED_NOW,
      });

      const first = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(0);
      expectStatus(runner.getState(), "persisting");
      await vi.advanceTimersByTimeAsync(PERSISTENCE_TIMEOUT_MS);
      expect(quiescent).toBe(false);
      expect(
        expectStatus(
          await runner.start({ modelId: DEFAULT_TARGET.modelId }),
          "failed",
        ).error.code,
      ).toBe("benchmark_already_running");

      await vi.advanceTimersByTimeAsync(100);
      expect(expectStatus(await first, "failed").error.code).toBe(
        "persistence_failed",
      );
      expect(quiescent).toBe(true);
      expect(await store.listResults()).toEqual([]);

      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "completed",
      );
      expect(
        (await store.listResults()).map((result) => result.outcome),
      ).toEqual(["completed"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stamps expiresAt using the canonical Phase-0 TTL formula from the injected clock", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake, {
      now: () => new Date("2026-03-01T00:00:00.000Z"),
    });

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const completed = expectStatus(result, "completed");
    expect(completed.result.createdAt).toBe("2026-03-01T00:00:00.000Z");
    expect(completed.result.expiresAt).toBe(
      new Date(
        Date.parse("2026-03-01T00:00:00.000Z") + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
  });
});

describe("createModelBenchmarkRunner -- metrics semantics (never fabricated)", () => {
  it("never invents a firstTokenTimeMs when a runtime error chunk carries no Phase-1 metrics at all, even though a token was seen", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      yield { type: "error", error: { code: "unknown", message: "boom" } };
    };
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const completed = expectStatus(result, "completed");
    expect(completed.result.stage).toBe("generating");
    expect(completed.result.firstToken).toEqual({});
    expect(completed.result.generation).toEqual({
      tokenCountConfidence: "unavailable",
    });
  });

  it("passes Phase-1 TTFT and overall-completion-throughput through unchanged, never recalculated", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      yield {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({
          timeToFirstTokenMs: 137,
          generationDurationMs: 913,
          completionTokens: 31,
          promptTokens: 9,
        }),
      };
    };
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    const completed = expectStatus(result, "completed");
    expect(completed.result.firstToken).toEqual({ firstTokenTimeMs: 137 });
    expect(completed.result.generation).toEqual({
      tokenCountConfidence: "exact",
      generationDurationMs: 913,
      generatedTokenCount: 31,
      overallCompletionTokensPerSecond: 31 / (913 / 1000),
    });
  });

  it("reports an unavailable-usage completion honestly, without inventing a token count or rate", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      yield {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({
          usageUnavailable: true,
          generationDurationMs: 700,
        }),
      };
    };
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });
    expect(expectStatus(result, "completed").result.generation).toEqual({
      tokenCountConfidence: "unavailable",
      generationDurationMs: 700,
    });
  });

  it("never persists a prompt-throughput-shaped field anywhere on the result", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("promptTokensPerSecond");
  });

  it("never reports a loadTimeMs when the model was reused (no load performed)", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });
    const completed = expectStatus(result, "completed");
    expect(completed.result.load.modelLoadedDuringRun).toBe(false);
    expect(completed.result.load.loadTimeMs).toBeUndefined();
  });
});

describe("createModelBenchmarkRunner -- runtime recovery", () => {
  it("does not call recoverRuntime() when the runtime is already ready after a natural completion", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner, recoverRuntime } = createTestRunner(fake);

    await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expect(recoverRuntime).not.toHaveBeenCalled();
  });

  it("calls recoverRuntime() after a caller cancellation leaves the runtime non-ready, and a subsequent real generation call succeeds afterward", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      fake.setRawState({ status: "generating" });
      yield { type: "token", text: "a" };
      await new Promise<void>((resolve) => {
        fake.onStopRequested = resolve;
      });
      // Mirrors runtime.ts's own documented behavior: a clean stream-based
      // cancellation leaves status "cancelling" until "the app recycles it"
      // (see runtime.test.ts's own test of that name).
      fake.setRawState({ status: "cancelling" });
      yield {
        type: "done",
        reason: "cancelled",
        metrics: makeDoneMetrics({
          timeToFirstTokenMs: 10,
          usageUnavailable: true,
        }),
      };
    };
    const recoverRuntime = vi.fn(async () => {
      fake.setRawState({ status: "ready" });
      return { isolated: true, ready: true };
    });
    const { runner } = createTestRunner(fake, { recoverRuntime });

    const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await waitForStatus(runner, "running");
    runner.cancel();
    const result = await startPromise;

    expectStatus(result, "completed");
    expect(recoverRuntime).toHaveBeenCalledTimes(1);

    // Prove the runtime is ACTUALLY usable again -- not just a status
    // string -- by making a fresh, real-chat-shaped generate() call succeed.
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "hello" };
      yield { type: "done", reason: "completed", metrics: makeDoneMetrics() };
    };
    const chunks: GenerateChunk[] = [];
    for await (const chunk of fake.runtime.generate({
      conversationId: "real-chat",
      prompt: "hi",
    })) {
      chunks.push(chunk);
    }
    expect(chunks.some((chunk) => chunk.type === "token")).toBe(true);
    expect(
      chunks.some(
        (chunk) => chunk.type === "done" && chunk.reason === "completed",
      ),
    ).toBe(true);
  });

  // A generation that ends with a runtime error and leaves the shared runtime
  // in "error", so the runner must invoke recovery before persisting.
  function failingGeneration(fake: FakeRuntimeHandle): void {
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      fake.setRawState({
        status: "error",
        error: { code: "unknown", message: "boom" },
      });
      yield { type: "error", error: { code: "unknown", message: "boom" } };
    };
  }

  function readyFake(): FakeRuntimeHandle {
    return createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
  }

  it("isolated=true, ready=false: evidence is persisted, ownership is RELEASED, and the run reports runtime_recovery_failed", async () => {
    const fake = readyFake();
    failingGeneration(fake);
    const recoverRuntime = vi.fn(async () => {
      fake.setRawState({
        status: "error",
        error: { code: "unknown", message: "still broken" },
      });
      return { isolated: true, ready: false };
    });
    const { runner, store } = createTestRunner(fake, { recoverRuntime });
    const operations = getRuntimeOperationCoordinator(fake.runtime);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expect(recoverRuntime).toHaveBeenCalledTimes(1);
    const failed = expectStatus(result, "failed");
    expect(failed.error.code).toBe("runtime_recovery_failed");
    expect(failed.persistedResult?.outcome).toBe("terminal_unknown");
    expect(await store.listResults()).toHaveLength(1);
    // The old runtime work IS isolated, so ownership is handed back even
    // though no usable runtime exists yet.
    expect(operations.isQuarantined()).toBe(false);
    const chatLease = operations.tryAcquire("chat-generation");
    expect(chatLease).not.toBeNull();
    chatLease?.release();
    const nextChunks: GenerateChunk[] = [];
    for await (const chunk of fake.runtime.generate({
      conversationId: "real-chat",
      prompt: "hi",
    }))
      nextChunks.push(chunk);
    expect(nextChunks).toEqual([
      {
        type: "error",
        error: {
          code: "unknown",
          message: "Runtime is not ready to generate.",
        },
      },
    ]);
  });

  it.each([
    ["isolated=false, ready=false", { isolated: false, ready: false }],
    [
      "isolated=false, ready=true (readiness without isolation is contradictory)",
      { isolated: false, ready: true },
    ],
    ["a legacy boolean true (not a two-fact result)", true],
    ["a legacy boolean false", false],
    ["null", null],
    ["a malformed object", { isolated: "yes", ready: 1 }],
  ])(
    "fails CLOSED on %s: evidence is persisted but ownership is QUARANTINED (runtime_isolation_failed)",
    async (_label, reported) => {
      const fake = readyFake();
      failingGeneration(fake);
      const recoverRuntime = vi.fn(
        async () => reported as unknown as { isolated: boolean; ready: boolean },
      );
      const { runner, store } = createTestRunner(fake, { recoverRuntime });
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const failed = expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "failed",
      );

      expect(failed.error.code).toBe("runtime_isolation_failed");
      expect(failed.persistedResult).toBeDefined();
      expect(await store.listResults()).toHaveLength(1);
      expect(operations.isQuarantined()).toBe(true);
      expect(operations.tryAcquire("chat-generation")).toBeNull();
    },
  );

  it("treats a rejected recovery as UNPROVEN isolation: evidence persisted, ownership quarantined, no leaked start() rejection", async () => {
    const fake = readyFake();
    failingGeneration(fake);
    const { runner, store } = createTestRunner(fake, {
      recoverRuntime: vi.fn(async () =>
        Promise.reject(new Error("recovery rejected")),
      ),
    });
    const operations = getRuntimeOperationCoordinator(fake.runtime);

    const failed = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "failed",
    );

    expect(failed.error.code).toBe("runtime_isolation_failed");
    expect(failed.persistedResult).toBeDefined();
    expect(await store.listResults()).toHaveLength(1);
    expect(operations.tryAcquire("chat-generation")).toBeNull();
  });

  it("isolated=true but the runtime still reports a non-usable status is a readiness failure, never an isolation failure", async () => {
    const fake = readyFake();
    failingGeneration(fake);
    const { runner } = createTestRunner(fake, {
      // Claims ready, but never actually repairs the runtime.
      recoverRuntime: vi.fn(async () => ({ isolated: true, ready: true })),
    });
    const operations = getRuntimeOperationCoordinator(fake.runtime);

    const failed = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "failed",
    );

    expect(failed.error.code).toBe("runtime_recovery_failed");
    expect(operations.isQuarantined()).toBe(false);
  });

  it("a quarantined runtime refuses the NEXT benchmark before any trusted adapter runs, until isolation is explicitly proven", async () => {
    const fake = readyFake();
    failingGeneration(fake);
    const recoverRuntime = vi.fn(async () => ({
      isolated: false,
      ready: false,
    }));
    const { runner, resolver } = createTestRunner(fake, { recoverRuntime });
    const operations = getRuntimeOperationCoordinator(fake.runtime);

    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "failed",
    );
    const resolveCallsAfterFirst = resolver.calls.length;

    const second = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "failed",
    );
    expect(second.error.code).toBe("runtime_quarantined");
    expect(resolver.calls).toHaveLength(resolveCallsAfterFirst);
    expect(fake.generateCalls).toHaveLength(1);

    // Nothing but a recovery that PROVES isolation can lift the quarantine.
    expect(operations.clearQuarantine({ isolated: false, ready: false })).toBe(
      false,
    );
    expect(
      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "failed",
      ).error.code,
    ).toBe("runtime_quarantined");

    fake.setRawState({ status: "ready", error: null });
    expect(operations.clearQuarantine({ isolated: true, ready: false })).toBe(
      true,
    );
    naturalCompletion(fake);
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });

  it("aborts a timed-out recovery that honors its signal -- settling after abort still does not PROVE isolation", async () => {
    vi.useFakeTimers();
    try {
      const fake = readyFake();
      failingGeneration(fake);
      let abortObserved = false;
      const recoverRuntime = vi.fn(
        (context: { signal: AbortSignal }) =>
          new Promise<{ isolated: boolean; ready: boolean }>(
            (_resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => {
                  abortObserved = true;
                  const error = new Error("recovery aborted");
                  error.name = "AbortError";
                  reject(error);
                },
                { once: true },
              );
            },
          ),
      );
      const { runner, store } = createTestRunner(fake, { recoverRuntime });
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const resultPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(0);
      expectStatus(runner.getState(), "recovering");
      await vi.advanceTimersByTimeAsync(RUNTIME_RECOVERY_TIMEOUT_MS);
      const failed = expectStatus(await resultPromise, "failed");

      expect(abortObserved).toBe(true);
      expect(failed.error.code).toBe("runtime_isolation_failed");
      expect(failed.persistedResult).toBeDefined();
      expect(await store.listResults()).toHaveLength(1);
      expect(operations.tryAcquire("chat-generation")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("always runs recovery after a load timeout, even when the runtime status reads ready", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({ status: "idle" });
      isModelCachedMock.mockResolvedValue(true);
      fake.loadModelImpl = () => {
        // The runtime LOOKS ready, yet the abandoned load never settles.
        fake.setRawState({
          status: "ready",
          modelId: DEFAULT_TARGET.webllmModelId,
        });
        return new Promise(() => {});
      };
      const { runner, recoverRuntime } = createTestRunner(fake);

      const consent = expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "requires_model_load_consent",
      );
      const startPromise = runner.confirmConsent(consent.consentRequestId);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_100);
      const completed = expectStatus(await startPromise, "completed");

      expect(completed.result.outcome).toBe("load_timeout");
      expect(recoverRuntime).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("quarantines the runtime when the abandoned load cannot be proven isolated", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRuntime({ status: "idle" });
      isModelCachedMock.mockResolvedValue(true);
      fake.loadModelImpl = () => new Promise(() => {});
      const { runner } = createTestRunner(fake, {
        recoverRuntime: vi.fn(async () => ({ isolated: false, ready: false })),
      });
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const consent = expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "requires_model_load_consent",
      );
      const startPromise = runner.confirmConsent(consent.consentRequestId);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_100);
      const failed = expectStatus(await startPromise, "failed");

      expect(failed.error.code).toBe("runtime_isolation_failed");
      expect(failed.persistedResult?.outcome).toBe("load_timeout");
      expect(operations.tryAcquire("chat-generation")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("quarantines the runtime when a wedged generation cannot be proven isolated", async () => {
    vi.useFakeTimers();
    try {
      const fake = readyFake();
      fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
        yield { type: "token", text: "a" };
        await new Promise<void>(() => {});
      };
      const { runner } = createTestRunner(fake, {
        recoverRuntime: vi.fn(async () => ({ isolated: false, ready: false })),
      });
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(80_100);
      const failed = expectStatus(await startPromise, "failed");

      expect(failed.error.code).toBe("runtime_isolation_failed");
      expect(failed.persistedResult?.outcome).toBe("benchmark_timeout");
      expect(operations.tryAcquire("chat-generation")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never calls dispose() on the injected runtime itself", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expect(fake.disposeCallCount()).toBe(0);
  });

  it("leaves a pre-flight rejection's runtime completely untouched", async () => {
    const fake = createFakeRuntime({ status: "generating" });
    const { runner } = createTestRunner(fake);

    await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expect(fake.loadModelCalls).toHaveLength(0);
    expect(fake.generateCalls).toHaveLength(0);
    expect(fake.stopGenerationCallCount()).toBe(0);
  });
});

describe("createModelBenchmarkRunner -- bounded abandonment (no await-forever on a dependency)", () => {
  function readyFake(): FakeRuntimeHandle {
    return createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
  }

  function failingGeneration(fake: FakeRuntimeHandle): void {
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      fake.setRawState({
        status: "error",
        error: { code: "unknown", message: "boom" },
      });
      yield { type: "error", error: { code: "unknown", message: "boom" } };
    };
  }

  it("a store that IGNORES its abort signal cannot hold the run forever: it ends within timeout + grace as persistence_isolation_failed -- a STORAGE failure that never touches the runtime", async () => {
    vi.useFakeTimers();
    try {
      const fake = readyFake();
      naturalCompletion(fake);
      const store = new ModelBenchmarkStoreClient({
        store: createMemoryModelBenchmarkStore(),
      });
      const realRecord = store.recordResult.bind(store);
      const lateWrite = createDeferred<boolean>();
      let calls = 0;
      vi.spyOn(store, "recordResult").mockImplementation((result, options) => {
        calls += 1;
        return calls === 1 ? lateWrite.promise : realRecord(result, options);
      });
      const runner = createModelBenchmarkRunner({
        runtime: fake.runtime,
        targetResolver: createFakeResolver(),
        environmentProvider: createFakeEnvironmentProvider(),
        eligibilityEvaluator: createFakeEligibilityEvaluator(),
        recoverRuntime: vi.fn(async () => ({ isolated: true, ready: true })),
        store,
        now: FIXED_NOW,
      });
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const settled = trackSettlement(
        runner.start({ modelId: DEFAULT_TARGET.modelId }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expectStatus(runner.getState(), "persisting");

      await vi.advanceTimersByTimeAsync(PERSISTENCE_TIMEOUT_MS);
      expect(settled.value).toBeNull(); // aborted, still inside the grace
      await vi.advanceTimersByTimeAsync(PERSISTENCE_ABORT_GRACE_MS - 1);
      expect(settled.value).toBeNull();
      await vi.advanceTimersByTimeAsync(1);

      const failed = expectStatus(settled.value!, "failed");
      expect(failed.error.code).toBe("persistence_isolation_failed");
      // STORAGE state only: the runtime coordinator is not quarantined, and
      // normal chat/runtime use can proceed immediately.
      expect(operations.isQuarantined()).toBe(false);
      const chatLease = operations.tryAcquire("chat-generation");
      expect(chatLease).not.toBeNull();
      chatLease?.release();

      // A new BENCHMARK waits until the abandoned write settles (so a late
      // commit can never interleave with the next run's) ...
      expect(
        expectStatus(
          await runner.start({ modelId: DEFAULT_TARGET.modelId }),
          "failed",
        ).error.code,
      ).toBe("persistence_unsettled");

      // ... and the late settlement itself is inert, then lifts that block.
      lateWrite.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(runner.getState().status).toBe("failed");
      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "completed",
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a recovery adapter that IGNORES its abort signal is abandoned after timeout + grace: isolation unproven, ownership quarantined, evidence still persisted", async () => {
    vi.useFakeTimers();
    try {
      const fake = readyFake();
      failingGeneration(fake);
      const { runner, store } = createTestRunner(fake, {
        recoverRuntime: vi.fn(() => new Promise<never>(() => {})),
      });
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const settled = trackSettlement(
        runner.start({ modelId: DEFAULT_TARGET.modelId }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expectStatus(runner.getState(), "recovering");

      await vi.advanceTimersByTimeAsync(RUNTIME_RECOVERY_TIMEOUT_MS);
      expect(settled.value).toBeNull();
      await vi.advanceTimersByTimeAsync(RUNTIME_RECOVERY_ABORT_GRACE_MS - 1);
      expect(settled.value).toBeNull();
      await vi.advanceTimersByTimeAsync(1);

      const failed = expectStatus(settled.value!, "failed");
      expect(failed.error.code).toBe("runtime_isolation_failed");
      expect(failed.persistedResult).toBeDefined();
      expect(await store.listResults()).toHaveLength(1);
      expect(operations.tryAcquire("chat-generation")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a recovery adapter that settles inside the abort grace resolves the run EARLY (the grace is a ceiling, not a delay)", async () => {
    vi.useFakeTimers();
    try {
      const fake = readyFake();
      failingGeneration(fake);
      const { runner } = createTestRunner(fake, {
        recoverRuntime: vi.fn(
          (context: { signal: AbortSignal }) =>
            new Promise<never>((_resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => setTimeout(() => reject(new Error("aborted")), 500),
                { once: true },
              );
            }),
        ),
      });

      const settled = trackSettlement(
        runner.start({ modelId: DEFAULT_TARGET.modelId }),
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(RUNTIME_RECOVERY_TIMEOUT_MS + 500);

      expect(
        expectStatus(settled.value!, "failed").error.code,
      ).toBe("runtime_isolation_failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("when BOTH recovery and persistence ignore their abort signals the whole burst still ends within the proven ceiling", async () => {
    vi.useFakeTimers();
    try {
      const fake = readyFake();
      failingGeneration(fake);
      const store = new ModelBenchmarkStoreClient({
        store: createMemoryModelBenchmarkStore(),
      });
      vi.spyOn(store, "recordResult").mockImplementation(
        () => new Promise<boolean>(() => {}),
      );
      const runner = createModelBenchmarkRunner({
        runtime: fake.runtime,
        targetResolver: createFakeResolver(),
        environmentProvider: createFakeEnvironmentProvider(),
        eligibilityEvaluator: createFakeEligibilityEvaluator(),
        recoverRuntime: vi.fn(() => new Promise<never>(() => {})),
        store,
        now: FIXED_NOW,
      });
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const settled = trackSettlement(
        runner.start({ modelId: DEFAULT_TARGET.modelId }),
      );
      const expectedEndMs =
        RUNTIME_RECOVERY_TIMEOUT_MS +
        RUNTIME_RECOVERY_ABORT_GRACE_MS +
        PERSISTENCE_TIMEOUT_MS +
        PERSISTENCE_ABORT_GRACE_MS;
      await vi.advanceTimersByTimeAsync(expectedEndMs - 1);
      expect(settled.value).toBeNull();
      await vi.advanceTimersByTimeAsync(1);

      const failed = expectStatus(settled.value!, "failed");
      // The runtime isolation failure outranks the persistence one.
      expect(failed.error.code).toBe("runtime_isolation_failed");
      expect(expectedEndMs).toBeLessThanOrEqual(maxAutomatedBurstMs());
      expect(operations.isQuarantined()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not skip mandatory recovery just because the work budget is already spent", async () => {
    vi.useFakeTimers();
    try {
      const fake = readyFake();
      fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
        await sleep(150);
        fake.setRawState({
          status: "error",
          error: { code: "unknown", message: "boom" },
        });
        yield { type: "error", error: { code: "unknown", message: "boom" } };
      };
      const { runner, recoverRuntime } = createTestRunner(fake, {
        automatedBudgetMs: 100,
      });

      const resultPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
      await vi.advanceTimersByTimeAsync(101);
      const failed = expectStatus(await resultPromise, "failed");

      // The budget was gone before recovery began, yet recovery -- the only
      // thing that can isolate the abandoned stream -- still ran in full.
      expect(recoverRuntime).toHaveBeenCalledTimes(1);
      // Evidence persistence is a WORK step and honestly reports the spent
      // budget instead.
      expect(failed.error.code).toBe("persistence_failed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createModelBenchmarkRunner -- completed requires the runtime to actually be ready", () => {
  function failingGenerationFake(): FakeRuntimeHandle {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      fake.setRawState({
        status: "error",
        error: { code: "unknown", message: "boom" },
      });
      yield { type: "error", error: { code: "unknown", message: "boom" } };
    };
    return fake;
  }

  it("recovery says {isolated:true, ready:true} but the runtime reports 'idle': NOT completed -- idle is never silently normalized to ready", async () => {
    const fake = failingGenerationFake();
    const recoverRuntime = vi.fn(async () => {
      fake.setRawState({ status: "idle", modelId: null, error: null });
      return { isolated: true, ready: true };
    });
    const { runner, store } = createTestRunner(fake, { recoverRuntime });
    const operations = getRuntimeOperationCoordinator(fake.runtime);

    const failed = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "failed",
    );

    expect(recoverRuntime).toHaveBeenCalledTimes(1);
    expect(failed.error.code).toBe("runtime_recovery_failed");
    // Evidence is still persisted, ownership is released (isolated), nothing
    // is quarantined.
    expect(failed.persistedResult).toBeDefined();
    expect(await store.listResults()).toHaveLength(1);
    expect(operations.isQuarantined()).toBe(false);
    expect(operations.tryAcquire("chat-generation")).not.toBeNull();
  });

  it("recovery says {isolated:true, ready:true} and the runtime really reports 'ready': completed is allowed", async () => {
    const fake = failingGenerationFake();
    const recoverRuntime = vi.fn(async () => {
      fake.setRawState({
        status: "ready",
        modelId: DEFAULT_TARGET.webllmModelId,
        error: null,
      });
      return { isolated: true, ready: true };
    });
    const { runner } = createTestRunner(fake, { recoverRuntime });

    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
    expect(recoverRuntime).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "loading_model", "cancelling", "recovering"] as const)(
    "recovery claims ready while the runtime reports %s: a contract violation, failed closed as runtime_recovery_failed",
    async (status) => {
      const fake = failingGenerationFake();
      const { runner } = createTestRunner(fake, {
        recoverRuntime: vi.fn(async () => {
          fake.setRawState({ status, error: null });
          return { isolated: true, ready: true };
        }),
      });

      expect(
        expectStatus(
          await runner.start({ modelId: DEFAULT_TARGET.modelId }),
          "failed",
        ).error.code,
      ).toBe("runtime_recovery_failed");
    },
  );
});

describe("createModelBenchmarkRunner -- persistence is separate from the runtime", () => {
  function readyFake(): FakeRuntimeHandle {
    return createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
  }

  function runnerWithStore(
    fake: FakeRuntimeHandle,
    store: ModelBenchmarkStoreClient,
  ) {
    return createModelBenchmarkRunner({
      runtime: fake.runtime,
      targetResolver: createFakeResolver(),
      environmentProvider: createFakeEnvironmentProvider(),
      eligibilityEvaluator: createFakeEligibilityEvaluator(),
      recoverRuntime: vi.fn(async () => ({ isolated: true, ready: true })),
      store,
      now: FIXED_NOW,
    });
  }

  it("the runtime lease is released BEFORE persistence starts: chat can acquire the runtime while the result is still being written", async () => {
    const fake = readyFake();
    naturalCompletion(fake);
    const store = new ModelBenchmarkStoreClient({
      store: createMemoryModelBenchmarkStore(),
    });
    const realRecord = store.recordResult.bind(store);
    const write = createDeferred<void>();
    vi.spyOn(store, "recordResult").mockImplementation(async (result, options) => {
      await write.promise;
      return realRecord(result, options);
    });
    const runner = runnerWithStore(fake, store);
    const operations = getRuntimeOperationCoordinator(fake.runtime);

    const runPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await waitForStatus(runner, "persisting");

    const chatLease = operations.tryAcquire("chat-generation");
    expect(chatLease).not.toBeNull();
    chatLease?.release();

    write.resolve();
    expectStatus(await runPromise, "completed");
  });

  it.each([
    ["the store throws", () => Promise.reject(new Error("disk full"))],
    ["the store reports it did not write", () => Promise.resolve(false)],
  ])(
    "persistence failure (%s) fails the run as persistence_failed WITHOUT quarantining or holding the runtime: normal chat can still acquire it",
    async (_label, outcome) => {
      const fake = readyFake();
      naturalCompletion(fake);
      const store = new ModelBenchmarkStoreClient({
        store: createMemoryModelBenchmarkStore(),
      });
      vi.spyOn(store, "recordResult").mockImplementation(outcome);
      const runner = runnerWithStore(fake, store);
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const failed = expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "failed",
      );

      expect(failed.error.code).toBe("persistence_failed");
      expect(operations.isQuarantined()).toBe(false);
      const chatLease = operations.tryAcquire("chat-generation");
      expect(chatLease).not.toBeNull();
      chatLease?.release();
    },
  );

  it("a store that settles inside the abort grace is an ordinary persistence_failed: the runtime is free and the next benchmark may start at once", async () => {
    vi.useFakeTimers();
    try {
      const fake = readyFake();
      naturalCompletion(fake);
      const store = new ModelBenchmarkStoreClient({
        store: createMemoryModelBenchmarkStore(),
      });
      const realRecord = store.recordResult.bind(store);
      let calls = 0;
      vi.spyOn(store, "recordResult").mockImplementation((result, options) => {
        calls += 1;
        if (calls > 1) return realRecord(result, options);
        return new Promise<boolean>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        });
      });
      const runner = runnerWithStore(fake, store);
      const operations = getRuntimeOperationCoordinator(fake.runtime);

      const first = trackSettlement(
        runner.start({ modelId: DEFAULT_TARGET.modelId }),
      );
      await vi.advanceTimersByTimeAsync(PERSISTENCE_TIMEOUT_MS);

      expect(expectStatus(first.value!, "failed").error.code).toBe(
        "persistence_failed",
      );
      expect(operations.isQuarantined()).toBe(false);
      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "completed",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createModelBenchmarkRunner -- only a trusted package-owned store may back the runner", () => {
  function runnerOptionsWith(store?: unknown) {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    return {
      runtime: fake.runtime,
      targetResolver: createFakeResolver(),
      environmentProvider: createFakeEnvironmentProvider(),
      eligibilityEvaluator: createFakeEligibilityEvaluator(),
      recoverRuntime: vi.fn(async () => ({ isolated: true, ready: true })),
      ...(store === undefined
        ? {}
        : { store: store as ModelBenchmarkStoreClient }),
      now: FIXED_NOW,
    };
  }

  it("refuses a structurally compatible object that merely LOOKS like a store client", () => {
    const structuralFake = {
      recordResult: async () => true,
      listResults: async () => [],
      listResultsForModel: async () => [],
      clearAll: async () => {},
      clearForModel: async () => {},
    };

    expect(() =>
      createModelBenchmarkRunner(runnerOptionsWith(structuralFake)),
    ).toThrow(TypeError);
  });

  it("refuses a forged object that borrows the client's prototype without ever going through its constructor", () => {
    const forged = Object.create(ModelBenchmarkStoreClient.prototype);

    expect(() =>
      createModelBenchmarkRunner(runnerOptionsWith(forged)),
    ).toThrow(TypeError);
  });

  it("refuses a Proxy wrapped around a genuine client (identity, not behavior, is what is trusted)", () => {
    const genuine = new ModelBenchmarkStoreClient({
      store: createMemoryModelBenchmarkStore(),
    });
    const proxied = new Proxy(genuine, {});

    expect(() =>
      createModelBenchmarkRunner(runnerOptionsWith(proxied)),
    ).toThrow(TypeError);
  });

  it("a client cannot be subclassed to override recordResult() and drop the cancellation guarantees", () => {
    class LeakyClient extends ModelBenchmarkStoreClient {
      override async recordResult(): Promise<boolean> {
        return true;
      }
    }

    expect(
      () => new LeakyClient({ store: createMemoryModelBenchmarkStore() }),
    ).toThrow(TypeError);
  });

  it("a client refuses to wrap a backend the package did not create, even one cast to the right shape", () => {
    const structuralBackend = {
      putAndPrune: async () => {},
      get: async () => null,
      getAll: async () => [],
      delete: async () => {},
      clear: async () => {},
      clearForModel: async () => {},
    };

    expect(
      () =>
        new ModelBenchmarkStoreClient({
          store: structuralBackend as never,
        }),
    ).toThrow(TypeError);
  });

  it("accepts a genuine client (with a package-created backend) and the default client", () => {
    const genuine = new ModelBenchmarkStoreClient({
      store: createMemoryModelBenchmarkStore(),
    });

    expect(() =>
      createModelBenchmarkRunner(runnerOptionsWith(genuine)),
    ).not.toThrow();
    // No store at all: the runner builds its own default, trusted client.
    expect(() =>
      createModelBenchmarkRunner(runnerOptionsWith()),
    ).not.toThrow();
  });
});

describe("createModelBenchmarkRunner -- subscribers never control runner flow", () => {
  function readyFake(): FakeRuntimeHandle {
    return createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
  }

  it("a listener that throws on every state change cannot break start(), cleanup, or the next run", async () => {
    const fake = readyFake();
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);
    const seen: string[] = [];
    runner.subscribe(() => {
      throw new Error("subscriber bug");
    });
    runner.subscribe((state) => {
      seen.push(state.status);
    });

    const first = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expectStatus(first, "completed");
    expect(seen).toEqual(["checking", "running", "persisting", "completed"]);
    // activeRun was cleaned up: the very next run starts and completes.
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });

  it("a listener that throws while the CONSENT request is published cannot turn it into runner_failed", async () => {
    const fake = createFakeRuntime({ status: "idle" });
    fake.loadModelImpl = async () => ({ loadTimeMs: 1 });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);
    runner.subscribe(() => {
      throw new Error("subscriber bug");
    });

    const parked = expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "requires_model_load_consent",
    );
    expect(parked.consentRequestId).toMatch(/^consent-/);
    expect(runner.getState()).toEqual(parked);

    expectStatus(await runner.confirmConsent(parked.consentRequestId), "completed");
  });

  it("a listener that throws on the FINAL failed state still resolves start() and frees the runner", async () => {
    const fake = readyFake();
    naturalCompletion(fake);
    const eligibilityEvaluator = createFakeEligibilityEvaluator();
    eligibilityEvaluator.impl = () => ({
      eligible: false,
      reasonCode: "not-enough-memory",
      message: "This device does not have enough memory.",
    });
    const { runner } = createTestRunner(fake, { eligibilityEvaluator });
    runner.subscribe(() => {
      throw new Error("subscriber bug");
    });

    expect(
      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "failed",
      ).error.code,
    ).toBe("ineligible_model");

    eligibilityEvaluator.impl = () => ({ eligible: true });
    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  });

  it("a listener that throws inside cancel() cannot make cancel() throw or wedge the run", async () => {
    const fake = readyFake();
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      if (!fake.isStopRequested()) {
        await new Promise<void>((resolve) => {
          fake.onStopRequested = resolve;
        });
      }
      fake.setRawState({ status: "cancelling" });
      yield {
        type: "done",
        reason: "cancelled",
        metrics: makeDoneMetrics({
          timeToFirstTokenMs: null,
          usageUnavailable: true,
        }),
      };
    };
    const { runner } = createTestRunner(fake);
    runner.subscribe((state) => {
      if (state.status === "cancelling") throw new Error("subscriber bug");
    });

    const startPromise = runner.start({ modelId: DEFAULT_TARGET.modelId });
    await waitForStatus(runner, "running");
    expect(() => runner.cancel()).not.toThrow();

    expectStatus(await startPromise, "completed");
  });

  it("an async listener that rejects never produces an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const fake = readyFake();
      naturalCompletion(fake);
      const { runner } = createTestRunner(fake);
      runner.subscribe(async () => {
        throw new Error("async subscriber bug");
      });

      expectStatus(
        await runner.start({ modelId: DEFAULT_TARGET.modelId }),
        "completed",
      );
      await sleep(20);

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("unsubscribing during a notification is well-defined: an unsubscribed listener is never called afterwards and nobody is skipped", async () => {
    const fake = readyFake();
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);
    const calls: string[] = [];
    let unsubscribeB: () => void = () => {};
    runner.subscribe((state) => {
      calls.push(`a:${state.status}`);
      if (state.status === "checking") unsubscribeB();
    });
    unsubscribeB = runner.subscribe((state) => {
      calls.push(`b:${state.status}`);
    });
    let unsubscribeSelf: () => void = () => {};
    unsubscribeSelf = runner.subscribe((state) => {
      calls.push(`self:${state.status}`);
      unsubscribeSelf();
    });
    runner.subscribe((state) => {
      calls.push(`c:${state.status}`);
    });

    expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );

    // B was unsubscribed by A before B's first notification.
    expect(calls.filter((entry) => entry.startsWith("b:"))).toEqual([]);
    // The self-unsubscribing listener saw exactly one state, and did not
    // cause the next listener to be skipped for it.
    expect(calls.filter((entry) => entry.startsWith("self:"))).toEqual([
      "self:checking",
    ]);
    expect(calls.filter((entry) => entry.startsWith("c:"))).toEqual([
      "c:checking",
      "c:running",
      "c:persisting",
      "c:completed",
    ]);
  });

  it("a listener that re-enters the runner (cancel() from inside a callback) never makes later listeners observe states out of order", async () => {
    const fake = readyFake();
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      if (!fake.isStopRequested()) {
        await new Promise<void>((resolve) => {
          fake.onStopRequested = resolve;
        });
      }
      fake.setRawState({ status: "cancelling" });
      yield {
        type: "done",
        reason: "cancelled",
        metrics: makeDoneMetrics({
          timeToFirstTokenMs: null,
          usageUnavailable: true,
        }),
      };
    };
    const { runner } = createTestRunner(fake);
    runner.subscribe((state) => {
      if (state.status === "running") runner.cancel();
    });
    const observed: string[] = [];
    runner.subscribe((state) => {
      observed.push(state.status);
    });

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expectStatus(result, "completed");
    expect(observed.indexOf("running")).toBeGreaterThan(-1);
    expect(observed.indexOf("running")).toBeLessThan(
      observed.indexOf("cancelling"),
    );
    expect(observed[observed.length - 1]).toBe("completed");
  });
});

describe("createModelBenchmarkRunner -- an empty completion is never positive evidence", () => {
  function readyFake(): FakeRuntimeHandle {
    return createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
  }

  async function runWith(chunks: GenerateChunk[]) {
    const fake = readyFake();
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      for (const chunk of chunks) yield chunk;
    };
    const { runner } = createTestRunner(fake);
    return expectStatus(
      await runner.start({ modelId: DEFAULT_TARGET.modelId }),
      "completed",
    );
  }

  it("exact completionTokens === 0 with output observed is neutral terminal_unknown, never completed", async () => {
    const completed = await runWith([
      { type: "token", text: "a" },
      {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({ completionTokens: 0 }),
      },
    ]);

    expect(completed.result.stage).toBe("complete");
    expect(completed.result.outcome).toBe("terminal_unknown");
    expect(classifyModelBenchmarkStability(completed.result.outcome)).toBe(
      "neutral",
    );
    // The measurement itself stays truthful -- exactly zero tokens, zero rate.
    expect(completed.result.generation).toMatchObject({
      tokenCountConfidence: "exact",
      generatedTokenCount: 0,
      overallCompletionTokensPerSecond: 0,
    });
  });

  it("exact completionTokens === 0 and no output at all is neutral terminal_unknown", async () => {
    const completed = await runWith([
      {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({ completionTokens: 0 }),
      },
    ]);

    expect(completed.result.outcome).toBe("terminal_unknown");
  });

  it("exact completionTokens > 0 but NO output ever observed is a contradiction and fails closed to neutral", async () => {
    const completed = await runWith([
      {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({ completionTokens: 20 }),
      },
    ]);

    expect(completed.result.outcome).toBe("terminal_unknown");
    expect(classifyModelBenchmarkStability(completed.result.outcome)).toBe(
      "neutral",
    );
  });

  it("empty-text chunks alone are not observed output", async () => {
    const completed = await runWith([
      { type: "token", text: "" },
      { type: "token", text: "" },
      {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({ completionTokens: 20 }),
      },
    ]);

    expect(completed.result.outcome).toBe("terminal_unknown");
  });

  it("unavailable usage with NOTHING observed is neutral terminal_unknown", async () => {
    const completed = await runWith([
      {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({ usageUnavailable: true }),
      },
    ]);

    expect(completed.result.outcome).toBe("terminal_unknown");
    expect(completed.result.generation.tokenCountConfidence).toBe(
      "unavailable",
    );
  });

  it("unavailable usage with output actually observed is still honestly completed", async () => {
    const completed = await runWith([
      { type: "token", text: "hello" },
      {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({ usageUnavailable: true }),
      },
    ]);

    expect(completed.result.outcome).toBe("completed");
    expect(classifyModelBenchmarkStability(completed.result.outcome)).toBe(
      "positive",
    );
  });

  it("exact positive tokens with observed output remain completed", async () => {
    const completed = await runWith([
      { type: "token", text: "hello" },
      {
        type: "done",
        reason: "completed",
        metrics: makeDoneMetrics({ completionTokens: 31 }),
      },
    ]);

    expect(completed.result.outcome).toBe("completed");
  });
});

describe("createModelBenchmarkRunner -- privacy", () => {
  it("never lets extra fields on a runtime chunk's metrics/usage survive into the persisted result", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    fake.generateImpl = async function* (): AsyncGenerator<GenerateChunk> {
      yield { type: "token", text: "a" };
      const metrics = makeDoneMetrics() as GenerationRuntimeMetrics & {
        rawOutput?: string;
      };
      metrics.rawOutput = "LEAK_MARKER_RAW_OUTPUT";
      (metrics.usage as unknown as { reasoning?: string }).reasoning =
        "LEAK_MARKER_REASONING";
      yield { type: "done", reason: "completed", metrics };
    };
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("LEAK_MARKER_RAW_OUTPUT");
    expect(serialized).not.toContain("LEAK_MARKER_REASONING");
  });

  it("uses the fixed benchmark prompt for generation but never exposes it through runner state", async () => {
    const fake = createFakeRuntime({
      status: "ready",
      modelId: DEFAULT_TARGET.webllmModelId,
    });
    naturalCompletion(fake);
    const { runner } = createTestRunner(fake);

    const result = await runner.start({ modelId: DEFAULT_TARGET.modelId });

    expect(fake.generateCalls).toHaveLength(1);
    expect(fake.generateCalls[0]?.prompt).toBe(getQuickBenchmarkPrompt());
    expect(JSON.stringify(result)).not.toContain(getQuickBenchmarkPrompt());
  });
});

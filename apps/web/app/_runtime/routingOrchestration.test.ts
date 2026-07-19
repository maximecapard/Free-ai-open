import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InferenceRuntime, RuntimeState } from "@free-ai-open/ai-runtime";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { StaticCapabilityProfile } from "@free-ai-open/types";

const mocks = vi.hoisted(() => ({
  isModelCached: vi.fn(),
  getStoredLocalBenchmarkForProfile: vi.fn(),
  getStoredCapabilityProfile: vi.fn(),
  detectAndStoreDeviceProfile: vi.fn(),
  getStoredModelPerformanceObservations: vi.fn(),
  recordModelPerformanceObservation: vi.fn(),
}));

vi.mock("@free-ai-open/ai-runtime", () => ({ isModelCached: mocks.isModelCached }));

vi.mock("@free-ai-open/model-registry", () => ({
  MODEL_REGISTRY_VERSION: "0.7.0-alpha.1",
  modelRegistryV2: [
    { id: "smollm2-360m-instruct-q4f32", webllmModelId: "SmolLM2-360M-Instruct-q4f32_1-MLC" },
    { id: "qwen3-0.6b-q4f16", webllmModelId: "Qwen3-0.6B-q4f16_1-MLC" },
  ],
}));

vi.mock("../_lib/benchmarkResultStore", () => ({
  getStoredLocalBenchmarkForProfile: mocks.getStoredLocalBenchmarkForProfile,
}));
vi.mock("../_lib/capabilityProfileStore", () => ({ getStoredCapabilityProfile: mocks.getStoredCapabilityProfile }));
vi.mock("../_lib/deviceProfileDetection", () => ({ detectAndStoreDeviceProfile: mocks.detectAndStoreDeviceProfile }));
vi.mock("../_lib/modelObservationStore", () => ({
  getStoredModelPerformanceObservations: mocks.getStoredModelPerformanceObservations,
  recordModelPerformanceObservation: mocks.recordModelPerformanceObservation,
}));

const {
  attemptModelLoadWithFallback,
  buildLoadCandidatesFromDecision,
  buildRouterInputContext,
  filterDisclosedLoadCandidates,
  registryIdForWebllmModelId,
} =
  await import("./routingOrchestration");

const CAPABILITY_FIXTURE = {
  schemaVersion: 2,
  detectedAt: "2026-07-18T00:00:00.000Z",
  expiresAt: "2026-07-25T00:00:00.000Z",
  formFactor: "desktop",
  architectureClass: "x86",
  browserFamily: "chrome",
  osFamily: "windows",
  memoryClass: "high",
  logicalProcessorClass: "high",
  webgpuAvailable: true,
  wasmAvailable: true,
  capabilityClass: "capable",
  deviceTier: 3,
  gpu: { featureClasses: [], limitClasses: {} },
  confidence: "high",
} as unknown as StaticCapabilityProfile;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoredModelPerformanceObservations.mockReturnValue([]);
});

describe("buildRouterInputContext", () => {
  it("uses the stored capability profile without re-detecting when one is already valid", async () => {
    mocks.getStoredCapabilityProfile.mockReturnValue(CAPABILITY_FIXTURE);
    mocks.getStoredLocalBenchmarkForProfile.mockReturnValue(null);
    mocks.isModelCached.mockResolvedValue(false);

    const input = await buildRouterInputContext({ task: "chat", locale: "en", performanceMode: "balanced" });

    expect(input?.capability).toBe(CAPABILITY_FIXTURE);
    expect(mocks.detectAndStoreDeviceProfile).not.toHaveBeenCalled();
    expect(input?.registryVersion).toBe("0.7.0-alpha.1");
  });

  it("falls back to fresh detection when no valid capability profile is stored", async () => {
    mocks.getStoredCapabilityProfile.mockReturnValue(null);
    mocks.detectAndStoreDeviceProfile.mockResolvedValue({ staticCapabilityProfile: CAPABILITY_FIXTURE });
    mocks.getStoredLocalBenchmarkForProfile.mockReturnValue(null);
    mocks.isModelCached.mockResolvedValue(false);

    const input = await buildRouterInputContext({ task: "chat", locale: "en", performanceMode: "balanced" });

    expect(mocks.detectAndStoreDeviceProfile).toHaveBeenCalledOnce();
    expect(input?.capability).toBe(CAPABILITY_FIXTURE);
  });

  it("returns null when detection produces no usable capability profile", async () => {
    mocks.getStoredCapabilityProfile.mockReturnValue(null);
    mocks.detectAndStoreDeviceProfile.mockResolvedValue({});

    const input = await buildRouterInputContext({ task: "chat", locale: "en", performanceMode: "balanced" });

    expect(input).toBeNull();
  });

  it("omits the benchmark field when no benchmark is stored for this profile", async () => {
    mocks.getStoredCapabilityProfile.mockReturnValue(CAPABILITY_FIXTURE);
    mocks.getStoredLocalBenchmarkForProfile.mockReturnValue(null);
    mocks.isModelCached.mockResolvedValue(false);

    const input = await buildRouterInputContext({ task: "chat", locale: "en", performanceMode: "balanced" });

    expect(input?.benchmark).toBeUndefined();
  });

  it("derives cachedModelIds from real per-model cache checks, not registry metadata", async () => {
    mocks.getStoredCapabilityProfile.mockReturnValue(CAPABILITY_FIXTURE);
    mocks.getStoredLocalBenchmarkForProfile.mockReturnValue(null);
    mocks.isModelCached.mockImplementation(async (webllmModelId: string) =>
      Promise.resolve(webllmModelId === "Qwen3-0.6B-q4f16_1-MLC")
    );

    const input = await buildRouterInputContext({ task: "chat", locale: "en", performanceMode: "balanced" });

    expect(input?.cachedModelIds).toEqual(["qwen3-0.6b-q4f16"]);
  });

  it("threads the manual override id through when provided", async () => {
    mocks.getStoredCapabilityProfile.mockReturnValue(CAPABILITY_FIXTURE);
    mocks.getStoredLocalBenchmarkForProfile.mockReturnValue(null);
    mocks.isModelCached.mockResolvedValue(false);

    const input = await buildRouterInputContext({
      task: "coding",
      locale: "fr",
      performanceMode: "performance",
      manualModelId: "qwen3-4b-q4f16",
    });

    expect(input?.manualModelId).toBe("qwen3-4b-q4f16");
    expect(input?.task).toBe("coding");
    expect(input?.locale).toBe("fr");
  });
});

function createFakeRuntime(outcomes: Record<string, RuntimeState>): InferenceRuntime {
  let state: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };
  return {
    getState: () => state,
    subscribe: () => () => {},
    loadModel: async (modelId) => {
      state = outcomes[modelId ?? ""] ?? { status: "error", modelId: null, loadProgress: 0, error: { code: "unknown", message: "no fixture" } };
    },
    generate: async function* () {},
    stopGeneration: () => {},
    setGenerationWatchdogSuspended: () => {},
    dispose: async () => {},
  };
}

const CANDIDATE_A = { registryId: "model-a", webllmModelId: "Model-A-MLC" };
const CANDIDATE_B = { registryId: "model-b", webllmModelId: "Model-B-MLC" };

describe("attemptModelLoadWithFallback", () => {
  it("returns the first candidate that loads successfully and records exactly one observation", async () => {
    const runtime = createFakeRuntime({
      "Model-A-MLC": { status: "ready", modelId: "Model-A-MLC", loadProgress: 1, error: null },
    });

    const result = await attemptModelLoadWithFallback(runtime, [CANDIDATE_A, CANDIDATE_B]);

    expect(result).toEqual({
      registryId: "model-a",
      webllmModelId: "Model-A-MLC",
      succeeded: true,
      attemptedRegistryIds: ["model-a"],
      failedRegistryIds: [],
    });
    expect(mocks.recordModelPerformanceObservation).toHaveBeenCalledOnce();
  });

  it("records the observation under the registry ID, not the WebLLM model ID", async () => {
    const runtime = createFakeRuntime({
      "Model-A-MLC": { status: "ready", modelId: "Model-A-MLC", loadProgress: 1, error: null },
    });

    await attemptModelLoadWithFallback(runtime, [CANDIDATE_A]);

    expect(mocks.recordModelPerformanceObservation).toHaveBeenCalledWith(expect.objectContaining({ modelId: "model-a" }));
  });

  it("falls through to the next candidate on failure, recording an observation per attempt", async () => {
    const runtime = createFakeRuntime({
      "Model-A-MLC": { status: "error", modelId: null, loadProgress: 0, error: { code: "out_of_memory", message: "oom" } },
      "Model-B-MLC": { status: "ready", modelId: "Model-B-MLC", loadProgress: 1, error: null },
    });

    const result = await attemptModelLoadWithFallback(runtime, [CANDIDATE_A, CANDIDATE_B]);

    expect(result).toEqual({
      registryId: "model-b",
      webllmModelId: "Model-B-MLC",
      succeeded: true,
      attemptedRegistryIds: ["model-a", "model-b"],
      failedRegistryIds: ["model-a"],
    });
    expect(mocks.recordModelPerformanceObservation).toHaveBeenCalledTimes(2);
  });

  it("returns null IDs when every candidate fails", async () => {
    const runtime = createFakeRuntime({});

    const result = await attemptModelLoadWithFallback(runtime, [CANDIDATE_A, CANDIDATE_B]);

    expect(result).toEqual({
      registryId: null,
      webllmModelId: null,
      succeeded: false,
      attemptedRegistryIds: ["model-a", "model-b"],
      failedRegistryIds: ["model-a", "model-b"],
    });
    expect(mocks.recordModelPerformanceObservation).toHaveBeenCalledTimes(2);
  });

  it("reports each attempt's zero-based index via onAttempt before it loads", async () => {
    const runtime = createFakeRuntime({
      "Model-B-MLC": { status: "ready", modelId: "Model-B-MLC", loadProgress: 1, error: null },
    });
    const attempts: Array<{ registryId: string; attemptIndex: number }> = [];

    await attemptModelLoadWithFallback(runtime, [CANDIDATE_A, CANDIDATE_B], {
      onAttempt: (candidate, attemptIndex) => attempts.push({ registryId: candidate.registryId, attemptIndex }),
    });

    expect(attempts).toEqual([
      { registryId: "model-a", attemptIndex: 0 },
      { registryId: "model-b", attemptIndex: 1 },
    ]);
  });

  it("never retries a duplicate candidate id", async () => {
    const loadModel = vi.fn(async () => {});
    const runtime: InferenceRuntime = {
      getState: () => ({ status: "error", modelId: null, loadProgress: 0, error: { code: "unknown", message: "x" } }),
      subscribe: () => () => {},
      loadModel,
      generate: async function* () {},
      stopGeneration: () => {},
      setGenerationWatchdogSuspended: () => {},
      dispose: async () => {},
    };

    await attemptModelLoadWithFallback(runtime, [CANDIDATE_A, CANDIDATE_A, CANDIDATE_A]);

    expect(loadModel).toHaveBeenCalledOnce();
  });

  it("passes the router context budget into every load attempt", async () => {
    let state: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };
    const loadModel = vi.fn(async (modelId: string) => {
      state = { status: "ready", modelId, loadProgress: 1, error: null };
    });
    const runtime = {
      ...createFakeRuntime({}),
      getState: () => state,
      loadModel,
    } as InferenceRuntime;

    await attemptModelLoadWithFallback(runtime, [CANDIDATE_A], { contextWindowTokens: 2048 });

    expect(loadModel).toHaveBeenCalledWith("Model-A-MLC", {
      initialStatus: undefined,
      contextWindowTokens: 2048,
    });
  });
});

describe("filterDisclosedLoadCandidates", () => {
  it("keeps only cached, explicitly approved, or pre-disclosed candidates", async () => {
    mocks.isModelCached.mockImplementation(async (modelId: string) => modelId === "Model-B-MLC");
    const candidateC = { registryId: "model-c", webllmModelId: "Model-C-MLC" };
    const candidateD = { registryId: "model-d", webllmModelId: "Model-D-MLC" };

    const result = await filterDisclosedLoadCandidates(
      [CANDIDATE_A, CANDIDATE_B, candidateC, candidateD],
      {
        approvedRegistryIds: new Set(["model-c"]),
        preDisclosedRegistryIds: new Set(["model-d"]),
      }
    );

    expect(result.map((candidate) => candidate.registryId)).toEqual(["model-b", "model-c", "model-d"]);
  });
});

const REGISTRY_FIXTURE = [
  { id: "smollm2-360m-instruct-q4f32", webllmModelId: "SmolLM2-360M-Instruct-q4f32_1-MLC" },
  { id: "qwen3-1.7b-q4f16", webllmModelId: "Qwen3-1.7B-q4f16_1-MLC" },
] as unknown as ModelRegistryRecord[];

describe("buildLoadCandidatesFromDecision", () => {
  it("maps a selected model plus fallback chain to registry/WebLLM ID pairs in order", () => {
    const candidates = buildLoadCandidatesFromDecision(REGISTRY_FIXTURE, [
      "qwen3-1.7b-q4f16",
      "smollm2-360m-instruct-q4f32",
    ]);
    expect(candidates).toEqual([
      { registryId: "qwen3-1.7b-q4f16", webllmModelId: "Qwen3-1.7B-q4f16_1-MLC" },
      { registryId: "smollm2-360m-instruct-q4f32", webllmModelId: "SmolLM2-360M-Instruct-q4f32_1-MLC" },
    ]);
  });

  it("drops null entries and unknown registry IDs rather than throwing", () => {
    const candidates = buildLoadCandidatesFromDecision(REGISTRY_FIXTURE, [null, "no-such-model", "qwen3-1.7b-q4f16"]);
    expect(candidates).toEqual([{ registryId: "qwen3-1.7b-q4f16", webllmModelId: "Qwen3-1.7B-q4f16_1-MLC" }]);
  });

  it("returns an empty list when nothing in the chain is eligible", () => {
    expect(buildLoadCandidatesFromDecision(REGISTRY_FIXTURE, [null])).toEqual([]);
  });
});

describe("registryIdForWebllmModelId", () => {
  it("resolves a WebLLM model ID back to its registry ID", () => {
    expect(registryIdForWebllmModelId(REGISTRY_FIXTURE, "Qwen3-1.7B-q4f16_1-MLC")).toBe("qwen3-1.7b-q4f16");
  });

  it("returns null for an unloaded runtime (null WebLLM ID)", () => {
    expect(registryIdForWebllmModelId(REGISTRY_FIXTURE, null)).toBeNull();
  });

  it("returns null for a WebLLM ID no longer present in the registry", () => {
    expect(registryIdForWebllmModelId(REGISTRY_FIXTURE, "Some-Retired-Model-MLC")).toBeNull();
  });
});

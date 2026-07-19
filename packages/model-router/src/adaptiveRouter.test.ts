import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY_VERSION, modelRegistryV2 } from "@free-ai-open/model-registry";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { LocalBenchmarkResult, ModelPerformanceObservation, StaticCapabilityProfile } from "@free-ai-open/types";
import type { RouterInput } from "./adaptiveRouterContracts";
import { routeAdaptiveModel } from "./adaptiveRouter";

const NOW = new Date("2026-07-18T12:00:00.000Z");

function capability(overrides: Partial<StaticCapabilityProfile> = {}): StaticCapabilityProfile {
  return {
    schemaVersion: 2,
    detectedAt: "2026-07-18T10:00:00.000Z",
    expiresAt: "2026-07-25T10:00:00.000Z",
    formFactor: "desktop",
    architectureClass: "x86",
    browserFamily: "chromium",
    osFamily: "windows",
    memoryClass: "high",
    logicalProcessorClass: "high",
    approximateMemoryGB: 12,
    logicalProcessors: 12,
    webgpuAvailable: true,
    wasmAvailable: true,
    fallbackAdapter: false,
    capabilityClass: "performance",
    deviceTier: 4,
    gpu: { featureClasses: [], limitClasses: {} },
    confidence: "high",
    ...overrides,
  };
}

function benchmark(overrides: Partial<LocalBenchmarkResult> = {}): LocalBenchmarkResult {
  return {
    schemaVersion: 2,
    benchmarkVersion: "1.0.0",
    capabilityProfileKey: "desktop:performance:webgpu:native",
    measuredAt: "2026-07-18T10:05:00.000Z",
    expiresAt: "2026-07-25T10:05:00.000Z",
    status: "completed",
    stage: "complete",
    computeScore: 85,
    responsiveness: "responsive",
    stability: "stable",
    confidence: "medium",
    ...overrides,
  };
}

function observation(
  modelId: string,
  outcome: ModelPerformanceObservation["outcome"],
  overrides: Partial<ModelPerformanceObservation> = {}
): ModelPerformanceObservation {
  return {
    schemaVersion: 1,
    modelId,
    observedAt: "2026-07-18T11:00:00.000Z",
    loadSucceeded: outcome !== "load_failed" && outcome !== "out_of_memory" && outcome !== "device_lost",
    outcome,
    ...overrides,
  };
}

function input(overrides: Partial<RouterInput> = {}): RouterInput {
  return {
    task: "chat",
    locale: "en",
    performanceMode: "balanced",
    capability: capability(),
    benchmark: benchmark(),
    observations: [],
    cachedModelIds: [],
    registryVersion: MODEL_REGISTRY_VERSION,
    ...overrides,
  };
}

function route(routerInput: RouterInput, registry: readonly ModelRegistryRecord[] = modelRegistryV2) {
  return routeAdaptiveModel(routerInput, { registry, registryVersion: MODEL_REGISTRY_VERSION, now: () => NOW });
}

describe("adaptive router device and task scenarios", () => {
  it("distinguishes a 12 GB mobile device from a 12 GB performance desktop", () => {
    const mobile = route(input({
      performanceMode: "performance",
      capability: capability({ formFactor: "mobile", capabilityClass: "light", deviceTier: 1 }),
    }));
    const desktop = route(input({ performanceMode: "performance" }));

    expect(mobile.selectedModelId).not.toBe("qwen3-4b-q4f16");
    expect(mobile.rejectedModels).toContainEqual({ modelId: "qwen3-4b-q4f16", reasons: ["form_factor_unsupported"] });
    expect(desktop.selectedModelId).toBe("qwen3-4b-q4f16");
  });

  it("keeps weak mobile fast routing on a mobile-suitable compact model", () => {
    const decision = route(input({
      performanceMode: "fast",
      capability: capability({
        formFactor: "mobile",
        capabilityClass: "light",
        deviceTier: 1,
        approximateMemoryGB: 4,
        memoryClass: "medium",
        confidence: "medium",
      }),
      benchmark: benchmark({ computeScore: 20, confidence: "low", stability: "degraded" }),
    }));
    expect(["smollm2-360m-instruct-q4f32", "qwen3-0.6b-q4f16"]).toContain(decision.selectedModelId);
    expect(decision.reasons).toContain("mobile_optimized");
  });

  it.each([
    ["French writing", input({ task: "writing", locale: "fr" }), "qwen3-1.7b-q4f16"],
    ["English coding", input({ task: "coding", locale: "en" }), "qwen2.5-coder-1.5b-q4f16"],
  ] as const)("selects the expected specialist for %s", (_name, routerInput, expected) => {
    expect(route(routerInput).selectedModelId).toBe(expected);
  });

  it("remains conservative on an unknown low-confidence device", () => {
    const decision = route(input({
      capability: capability({
        formFactor: "unknown",
        architectureClass: "unknown",
        memoryClass: "unknown",
        logicalProcessorClass: "unknown",
        approximateMemoryGB: undefined,
        logicalProcessors: undefined,
        capabilityClass: "compatibility",
        deviceTier: 1,
        confidence: "low",
      }),
      benchmark: undefined,
    }));
    expect(decision.selectedModelId).not.toBe("qwen3-4b-q4f16");
    expect(decision.confidence).toBe("low");
    expect(decision.warnings).toEqual(expect.arrayContaining(["benchmark_missing", "resource_unknown"]));
  });

  it.each([
    ["WASM-only", capability({ webgpuAvailable: false, wasmAvailable: true, capabilityClass: "compatibility", deviceTier: 0 })],
    ["fallback adapter", capability({ fallbackAdapter: true, capabilityClass: "compatibility", deviceTier: 0 })],
  ] as const)("returns no eligible model for %s with the current registry", (_name, profile) => {
    const decision = route(input({ capability: profile, benchmark: undefined }));
    expect(decision.selectedModelId).toBeNull();
    expect(decision.warnings).toContain("no_eligible_model");
  });
});

describe("adaptive router benchmark, cache, and observations", () => {
  it("reduces confidence when the benchmark is absent or failed", () => {
    const absent = route(input({ benchmark: undefined }));
    const failed = route(input({ benchmark: benchmark({ status: "failed", errorCode: "timeout", stability: "failed", confidence: "low" }) }));
    expect(absent.warnings).toContain("benchmark_missing");
    expect(failed.warnings).toContain("benchmark_low_confidence");
    expect(absent.confidence).toBe("low");
    expect(failed.confidence).toBe("low");
  });

  it("ignores a benchmark measured for a different capability profile", () => {
    const decision = route(input({ benchmark: benchmark({ capabilityProfileKey: "mobile:light:webgpu:native" }) }));
    expect(decision.warnings).toContain("benchmark_missing");
    expect(decision.confidence).toBe("low");
  });

  it("uses a good benchmark as positive capability evidence without treating it as a recommendation", () => {
    const decision = route(input());
    expect(decision.confidence).toBe("medium");
    expect(decision.candidateScores.every((score) => score.capability >= 0 && score.capability <= 20)).toBe(true);
  });

  it("gives cache only a small bounded convenience bonus", () => {
    const uncached = route(input());
    const cached = route(input({ cachedModelIds: ["qwen3-0.6b-q4f16"] }));
    const before = uncached.candidateScores.find((score) => score.modelId === "qwen3-0.6b-q4f16")!;
    const after = cached.candidateScores.find((score) => score.modelId === "qwen3-0.6b-q4f16")!;
    expect(after.convenience - before.convenience).toBe(3);
    expect(after.total - before.total).toBe(3);
  });

  it("warns when an uncached large download is selected", () => {
    const decision = route(input({ performanceMode: "performance" }));
    expect(decision.selectedModelId).toBe("qwen3-4b-q4f16");
    expect(decision.warnings).toContain("download_large");
  });

  it("lets sufficient recent successful measurements outweigh static assumptions", () => {
    const fastObservations = Array.from({ length: 4 }, () => observation("qwen3-0.6b-q4f16", "completed", {
      generationTokensPerSecond: 30,
      firstTokenTimeMs: 250,
    }));
    const decision = route(input({ observations: fastObservations }));
    expect(decision.selectedModelId).toBe("qwen3-0.6b-q4f16");
    expect(decision.reasons).toEqual(expect.arrayContaining(["measured_stable", "measured_fast"]));
  });

  it.each([
    ["out of memory", "out_of_memory" as const, "repeated_oom" as const],
    ["device loss", "device_lost" as const, "repeated_device_loss" as const],
    ["generation stalls", "stalled" as const, "repeated_stall" as const],
  ])("hard-rejects repeated recent %s outcomes", (_name, outcome, rejection) => {
    const observations = [observation("qwen3-4b-q4f16", outcome), observation("qwen3-4b-q4f16", outcome)];
    const decision = route(input({ performanceMode: "performance", observations }));
    expect(decision.rejectedModels.find((item) => item.modelId === "qwen3-4b-q4f16")?.reasons).toContain(rejection);
    expect(decision.selectedModelId).not.toBe("qwen3-4b-q4f16");
  });

  it("does not penalize user cancellations", () => {
    const baseline = route(input());
    const cancelled = route(input({ observations: Array.from({ length: 5 }, () => observation("qwen3-1.7b-q4f16", "cancelled")) }));
    expect(cancelled.selectedModelId).toBe(baseline.selectedModelId);
    expect(cancelled.candidateScores).toEqual(baseline.candidateScores);
  });

  it("ignores cancellations even when mixed with successful observations", () => {
    const completed = [
      observation("qwen3-1.7b-q4f16", "completed", { generationTokensPerSecond: 18 }),
      observation("qwen3-1.7b-q4f16", "completed", { generationTokensPerSecond: 18 }),
    ];
    const cancellations = Array.from({ length: 5 }, () => observation("qwen3-1.7b-q4f16", "cancelled", { loadSucceeded: false }));
    const baseScore = route(input({ observations: completed })).candidateScores.find((item) => item.modelId === "qwen3-1.7b-q4f16");
    const mixedScore = route(input({ observations: [...completed, ...cancellations] })).candidateScores.find((item) => item.modelId === "qwen3-1.7b-q4f16");
    expect(mixedScore).toEqual(baseScore);
  });

  it("ignores stale observations", () => {
    const stale = observation("qwen3-4b-q4f16", "out_of_memory", { observedAt: "2026-05-01T00:00:00.000Z" });
    const baseline = route(input({ performanceMode: "performance" }));
    const withStale = route(input({ performanceMode: "performance", observations: [stale, stale] }));
    expect(withStale).toEqual(baseline);
  });
});

describe("adaptive router manual selection and fallbacks", () => {
  it("accepts an eligible manual selection", () => {
    const decision = route(input({ manualModelId: "qwen3-0.6b-q4f16" }));
    expect(decision.selectedModelId).toBe("qwen3-0.6b-q4f16");
    expect(decision.reasons[0]).toBe("manual_selection");
  });

  it("ignores an ineligible manual selection and keeps automatic routing", () => {
    const decision = route(input({
      manualModelId: "qwen3-4b-q4f16",
      capability: capability({ formFactor: "mobile", capabilityClass: "light", deviceTier: 1 }),
    }));
    expect(decision.selectedModelId).not.toBe("qwen3-4b-q4f16");
    expect(decision.warnings).toContain("manual_model_ineligible");
  });

  it("builds a bounded, acyclic, progressively lighter fallback chain", () => {
    const decision = route(input({ performanceMode: "performance" }));
    expect(decision.fallbackModelIds).toEqual([
      "qwen3-1.7b-q4f16",
      "qwen3-0.6b-q4f16",
      "smollm2-360m-instruct-q4f32",
    ]);
    expect(new Set([decision.selectedModelId, ...decision.fallbackModelIds]).size).toBe(4);
  });

  it("traverses an ineligible intermediate fallback to reach safer eligible models", () => {
    const failures = [
      observation("qwen3-1.7b-q4f16", "out_of_memory"),
      observation("qwen3-1.7b-q4f16", "out_of_memory"),
    ];
    const decision = route(input({ performanceMode: "performance", observations: failures }));
    expect(decision.selectedModelId).toBe("qwen3-4b-q4f16");
    expect(decision.fallbackModelIds).toEqual(["qwen3-0.6b-q4f16", "smollm2-360m-instruct-q4f32"]);
  });

  it("validates required features, limits, and memory before scoring", () => {
    const base = modelRegistryV2.find((model) => model.id === "qwen3-0.6b-q4f16")!;
    const constrained: ModelRegistryRecord = {
      ...base,
      fallbackModelIds: [],
      minimumCapability: {
        ...base.minimumCapability,
        approximateMemoryGB: 16,
        requiredFeatures: ["shader-f16"],
        minimumLimits: { maxBufferSize: 1 },
      },
    };
    const decision = route(input({ capability: capability({ approximateMemoryGB: 8 }) }), [constrained]);
    expect(decision.selectedModelId).toBeNull();
    expect(decision.rejectedModels[0]?.reasons).toEqual(expect.arrayContaining([
      "required_feature_missing", "required_limit_missing", "insufficient_memory",
    ]));
  });

  it("compares numeric minimum limits against conservative bucket lower bounds", () => {
    const base = modelRegistryV2.find((model) => model.id === "qwen3-0.6b-q4f16")!;
    const constrained: ModelRegistryRecord = {
      ...base,
      fallbackModelIds: [],
      minimumCapability: {
        ...base.minimumCapability,
        minimumLimits: { maxBufferSize: 700 * 1024 ** 2 },
      },
    };
    const decision = route(
      input({ capability: capability({ gpu: { featureClasses: [], limitClasses: { maxBufferSize: "high" } } }) }),
      [constrained]
    );
    expect(decision.rejectedModels[0]?.reasons).toContain("required_limit_missing");
  });

  it("does not report high confidence when resource capacity is unknown", () => {
    const completed = [
      observation("qwen3-1.7b-q4f16", "completed", { generationDurationMs: 1000 }),
      observation("qwen3-1.7b-q4f16", "completed", { generationDurationMs: 1000 }),
    ];
    const decision = route(input({ capability: capability({ approximateMemoryGB: undefined }), observations: completed }));
    expect(decision.confidence).not.toBe("high");
    expect(decision.warnings).toContain("resource_unknown");
  });

  it("returns no decision for an invalid registry", () => {
    const invalid = [{ ...modelRegistryV2[0], fallbackModelIds: [modelRegistryV2[0]!.id] }] as ModelRegistryRecord[];
    const decision = route(input(), invalid);
    expect(decision.selectedModelId).toBeNull();
    expect(decision.warnings).toEqual(["registry_invalid", "no_eligible_model"]);
  });

  it("uses conservative token presets until performance evidence is sufficient", () => {
    const fast = route(input({ performanceMode: "fast" }));
    const weakPerformance = route(input({
      performanceMode: "performance",
      capability: capability({ capabilityClass: "balanced", confidence: "medium" }),
      benchmark: undefined,
    }));
    const strongPerformance = route(input({ performanceMode: "performance" }));
    expect([fast.recommendedContextTokens, fast.recommendedMaxOutputTokens]).toEqual([1024, 256]);
    expect(weakPerformance.recommendedContextTokens).toBe(2048);
    expect(weakPerformance.warnings).toContain("performance_evidence_limited");
    expect(strongPerformance.recommendedContextTokens).toBe(4096);
  });
});

describe("adaptive router determinism and privacy", () => {
  it("returns identical decisions for identical normalized input", () => {
    expect(route(input())).toEqual(route(input()));
  });

  it("coarsens unsupported runtime values instead of throwing or producing NaN", () => {
    const malformed = {
      ...input(),
      task: "private_free_text",
      locale: "es",
      performanceMode: "turbo",
      cachedModelIds: ["unknown", 42],
      observations: null,
      capability: {
        ...capability(),
        formFactor: "watch",
        capabilityClass: "unbounded",
        approximateMemoryGB: Number.NaN,
        gpu: { featureClasses: ["shader-f16", 42], limitClasses: { maxBufferSize: "raw" } },
      },
    } as unknown as RouterInput;
    const decision = route(malformed);
    expect(decision.selectedModelId).not.toBeNull();
    expect(decision.confidence).toBe("low");
    expect(decision.candidateScores.every((score) => Number.isFinite(score.total))).toBe(true);
  });

  it("lowers confidence for a registry version mismatch", () => {
    const decision = route(input({ registryVersion: "stale-registry" }));
    expect(decision.confidence).toBe("low");
    expect(decision.warnings).toContain("registry_version_mismatch");
  });

  it("does not trust capability signals from an unsupported schema version", () => {
    const decision = route(input({ capability: capability({ schemaVersion: 99 }) }));
    expect(decision.selectedModelId).toBeNull();
    expect(decision.confidence).toBe("low");
    expect(decision.warnings).toEqual(expect.arrayContaining([
      "capability_schema_unsupported",
      "no_eligible_model",
    ]));
  });

  it("contains technical codes and model IDs only, never private content fields", () => {
    const serialized = JSON.stringify(route(input())).toLowerCase();
    for (const key of ["prompt", "response", "message", "conversation", "document", "usertext", "inputtext", "outputtext"]) {
      expect(serialized).not.toContain(`"${key}`);
    }
  });
});

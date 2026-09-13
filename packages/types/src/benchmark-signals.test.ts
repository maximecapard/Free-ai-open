import { describe, expect, it } from "vitest";
import { modelBenchmarkContextPresets, modelBenchmarkPresets } from "./benchmark-signals";
import type { ModelBenchmarkResult } from "./benchmark-signals";

const FORBIDDEN_KEYS = ["prompt", "response", "message", "messages", "conversation", "conversations", "document"];

function assertNoForbiddenKeys(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const key of FORBIDDEN_KEYS) {
    expect(serialized.toLowerCase()).not.toContain(`"${key}"`);
  }
}

function buildExample(overrides: Partial<ModelBenchmarkResult> = {}): ModelBenchmarkResult {
  return {
    schemaVersion: 1,
    benchmarkVersion: "1.0.0",
    id: "benchmark-1",
    modelId: "qwen3-4b-instruct-q4f16",
    model: {
      modelId: "qwen3-4b-instruct-q4f16",
      webllmModelId: "Qwen3-4B-Instruct-q4f16_1-MLC",
      registryVersion: "0.7.0-alpha.1",
      quantization: "q4f16_1",
      verifiedWithWebLLMVersion: "0.2.84",
    },
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: "2026-08-31T10:00:00.000Z",
    browserFamily: "chrome",
    capabilityProfileKey: "desktop:performance:webgpu:native",
    performanceMode: "performance",
    preset: "quick",
    runConfig: {
      contextPreset: "performance",
      contextWindowTokens: 4096,
      requestedOutputTokens: 512,
    },
    stage: "complete",
    outcome: "completed",
    load: {
      wasModelCachedBeforeRun: true,
      modelLoadedDuringRun: false,
    },
    firstToken: {
      firstTokenTimeMs: 320,
    },
    generation: {
      generationDurationMs: 4200,
      generatedTokenCount: 96,
      tokenCountConfidence: "exact",
      generationTokensPerSecond: 22.9,
    },
    confidence: "medium",
    environment: {
      webllmVersion: "0.2.84",
      appVersion: "0.8.0-alpha",
    },
    ...overrides,
  };
}

describe("modelBenchmarkPresets / modelBenchmarkContextPresets", () => {
  it("defines exactly the three documented benchmark presets", () => {
    expect(modelBenchmarkPresets).toEqual(["quick", "standard", "extended"]);
  });

  it("mirrors @free-ai-open/model-registry's contextPresetIds by value (compatibility, balanced, performance)", () => {
    // This package cannot import model-registry (it must stay dependency-
    // free), so this pins the literal values here and documents that they
    // must be kept in sync manually if the registry's own preset ids ever
    // change -- see this file's own top-of-module comment.
    expect(modelBenchmarkContextPresets).toEqual(["compatibility", "balanced", "performance"]);
  });
});

describe("ModelBenchmarkResult contract", () => {
  const example = buildExample();

  it("is a usable, schema-versioned shape covering every required field", () => {
    expect(example.schemaVersion).toBeTypeOf("number");
    expect(example.id).toBeTypeOf("string");
    expect(example.modelId).toBe(example.model.modelId);
    expect(example.outcome).toBe("completed");
  });

  it("carries an expiry strictly after createdAt, so a stale result can be treated as absent", () => {
    expect(Date.parse(example.expiresAt)).toBeGreaterThan(Date.parse(example.createdAt));
  });

  it("shares its outcome vocabulary exactly with ModelPerformanceObservation, including every neutral/negative case", () => {
    const outcomes: ModelBenchmarkResult["outcome"][] = [
      "completed",
      "cancelled",
      "stalled",
      "degenerate",
      "out_of_memory",
      "device_lost",
      "load_failed",
      "length_limited",
      "unsupported_tool_call",
      "terminal_unknown",
    ];
    for (const outcome of outcomes) {
      expect(buildExample({ outcome }).outcome).toBe(outcome);
    }
  });

  it("represents a model that was already loaded before the run with no load-time measurement at all", () => {
    const alreadyLoaded = buildExample({
      load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: false },
    });
    expect(alreadyLoaded.load.loadTimeMs).toBeUndefined();
  });

  it("represents an unavailable token-count confidence without a derived tokens-per-second figure -- not even expressible on this variant of the discriminated union", () => {
    const unavailable = buildExample({
      generation: { tokenCountConfidence: "unavailable" },
    });
    expect(unavailable.generation.tokenCountConfidence).toBe("unavailable");
    expect("generatedTokenCount" in unavailable.generation).toBe(false);
    expect("generationTokensPerSecond" in unavailable.generation).toBe(false);
  });

  it("accepts a load-failure result with no generation/first-token measurements at all", () => {
    const failed = buildExample({
      stage: "loading_model",
      outcome: "load_failed",
      load: { wasModelCachedBeforeRun: false, modelLoadedDuringRun: true },
      firstToken: {},
      generation: { tokenCountConfidence: "unavailable" },
    });
    expect(failed.firstToken.firstTokenTimeMs).toBeUndefined();
    expect(failed.generation.generationDurationMs).toBeUndefined();
  });

  it("never contains prompt/response/conversation-shaped fields", () => {
    assertNoForbiddenKeys(example);
  });
});

describe("ModelBenchmarkGenerationMeasurement discriminated union -- impossible states are unrepresentable at compile time", () => {
  it("does not allow an 'exact' measurement with a missing generatedTokenCount", () => {
    // @ts-expect-error -- generatedTokenCount is required when tokenCountConfidence is "exact"
    const invalid: ModelBenchmarkResult["generation"] = {
      tokenCountConfidence: "exact",
      generationDurationMs: 4000,
      generationTokensPerSecond: 24,
    };
    expect(invalid).toBeDefined();
  });

  it("does not allow an 'exact' measurement with a missing generationDurationMs", () => {
    // @ts-expect-error -- generationDurationMs is required when tokenCountConfidence is "exact"
    const invalid: ModelBenchmarkResult["generation"] = {
      tokenCountConfidence: "exact",
      generatedTokenCount: 96,
      generationTokensPerSecond: 24,
    };
    expect(invalid).toBeDefined();
  });

  it("does not allow an 'exact' measurement with a missing generationTokensPerSecond", () => {
    // @ts-expect-error -- generationTokensPerSecond is required when tokenCountConfidence is "exact"
    const invalid: ModelBenchmarkResult["generation"] = {
      tokenCountConfidence: "exact",
      generatedTokenCount: 96,
      generationDurationMs: 4000,
    };
    expect(invalid).toBeDefined();
  });

  it("does not allow generatedTokenCount/generationTokensPerSecond on the 'unavailable' variant", () => {
    const invalid: ModelBenchmarkResult["generation"] = {
      tokenCountConfidence: "unavailable",
      // @ts-expect-error -- generatedTokenCount does not exist on the "unavailable" variant
      generatedTokenCount: 96,
    };
    expect(invalid).toBeDefined();
  });
});

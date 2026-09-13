import { describe, expect, it } from "vitest";
import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { MODEL_BENCHMARK_VERSION } from "./constants";
import {
  filterUsableModelBenchmarkResults,
  isModelBenchmarkResultCompatible,
  isModelBenchmarkResultExpired,
  isModelBenchmarkResultUsable,
} from "./compatibility";
import type { ModelBenchmarkCompatibilityContext } from "./compatibility";

function buildResult(overrides: Partial<ModelBenchmarkResult> = {}): ModelBenchmarkResult {
  return {
    schemaVersion: 1,
    benchmarkVersion: MODEL_BENCHMARK_VERSION,
    id: "benchmark-1",
    modelId: "qwen3-4b-instruct-q4f16",
    model: {
      modelId: "qwen3-4b-instruct-q4f16",
      webllmModelId: "Qwen3-4B-Instruct-q4f16_1-MLC",
      registryVersion: "0.7.0-alpha.1",
    },
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: "2026-08-31T10:00:00.000Z",
    browserFamily: "chrome",
    capabilityProfileKey: "desktop:performance:webgpu:native",
    performanceMode: "performance",
    preset: "quick",
    runConfig: { contextPreset: "performance", contextWindowTokens: 4096, requestedOutputTokens: 512 },
    stage: "complete",
    outcome: "completed",
    load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: true, loadTimeMs: 1200 },
    firstToken: { firstTokenTimeMs: 300 },
    generation: {
      tokenCountConfidence: "exact",
      generationDurationMs: 4000,
      generatedTokenCount: 200,
      generationTokensPerSecond: 50,
    },
    environment: { webllmVersion: "0.2.84" },
    ...overrides,
  };
}

const MATCHING_CONTEXT: ModelBenchmarkCompatibilityContext = {
  registryVersion: "0.7.0-alpha.1",
  webllmVersion: "0.2.84",
  capabilityProfileKey: "desktop:performance:webgpu:native",
  browserFamily: "chrome",
};

describe("isModelBenchmarkResultExpired", () => {
  it("is false for a result whose expiresAt is in the future relative to `now`", () => {
    const result = buildResult({ expiresAt: "2026-09-01T00:00:00.000Z" });
    expect(isModelBenchmarkResultExpired(result, new Date("2026-08-15T00:00:00.000Z"))).toBe(false);
  });

  it("is true for a result whose expiresAt is in the past relative to `now`", () => {
    const result = buildResult({ expiresAt: "2026-08-01T00:00:01.000Z" });
    expect(isModelBenchmarkResultExpired(result, new Date("2026-09-01T00:00:00.000Z"))).toBe(true);
  });

  it("is true exactly at the expiry instant (expiresAt <= now)", () => {
    const result = buildResult({ expiresAt: "2026-09-01T00:00:00.000Z" });
    expect(isModelBenchmarkResultExpired(result, new Date("2026-09-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("isModelBenchmarkResultCompatible", () => {
  it("is true when benchmark version, registry version, WebLLM version, capability profile key, and browser family all match exactly", () => {
    expect(isModelBenchmarkResultCompatible(buildResult(), MATCHING_CONTEXT)).toBe(true);
  });

  it("is false on a benchmarkVersion mismatch -- an older or newer contract understanding is never usable evidence", () => {
    const result = buildResult({ benchmarkVersion: "0.9.0" });
    expect(isModelBenchmarkResultCompatible(result, MATCHING_CONTEXT)).toBe(false);
  });

  it("is false on a registry version mismatch -- the registry moved on since this ran", () => {
    const result = buildResult({ model: { ...buildResult().model, registryVersion: "0.7.0-alpha.2" } });
    expect(isModelBenchmarkResultCompatible(result, MATCHING_CONTEXT)).toBe(false);
  });

  it("is false on a WebLLM version mismatch -- the runtime backend has changed", () => {
    const result = buildResult({ environment: { webllmVersion: "0.2.85" } });
    expect(isModelBenchmarkResultCompatible(result, MATCHING_CONTEXT)).toBe(false);
  });

  it("is false on a capability profile key mismatch -- a materially different device/browser class", () => {
    const result = buildResult({ capabilityProfileKey: "mobile:light:webgpu:native" });
    expect(isModelBenchmarkResultCompatible(result, MATCHING_CONTEXT)).toBe(false);
  });

  it("is false on a browser family mismatch -- generation/load behavior can differ meaningfully across engines", () => {
    const result = buildResult({ browserFamily: "firefox" });
    expect(isModelBenchmarkResultCompatible(result, MATCHING_CONTEXT)).toBe(false);
  });

  it("never treats a partial match as compatible -- every signal must agree", () => {
    const result = buildResult({
      model: { ...buildResult().model, registryVersion: "0.7.0-alpha.1" },
      environment: { webllmVersion: "0.2.99" }, // only this one differs
      capabilityProfileKey: "desktop:performance:webgpu:native",
    });
    expect(isModelBenchmarkResultCompatible(result, MATCHING_CONTEXT)).toBe(false);
  });
});

describe("isModelBenchmarkResultUsable / filterUsableModelBenchmarkResults", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");

  it("is true only when both compatible AND not expired", () => {
    expect(isModelBenchmarkResultUsable(buildResult(), MATCHING_CONTEXT, now)).toBe(true);
  });

  it("is false when compatible but expired", () => {
    const expired = buildResult({ expiresAt: "2026-08-01T00:00:00.000Z" });
    expect(isModelBenchmarkResultUsable(expired, MATCHING_CONTEXT, now)).toBe(false);
  });

  it("is false when not expired but incompatible", () => {
    const incompatible = buildResult({ environment: { webllmVersion: "0.2.85" } });
    expect(isModelBenchmarkResultUsable(incompatible, MATCHING_CONTEXT, now)).toBe(false);
  });

  it("filters a mixed list down to only the usable results, preserving order", () => {
    const usable = buildResult({ id: "usable" });
    const expired = buildResult({ id: "expired", expiresAt: "2026-08-01T00:00:00.000Z" });
    const incompatible = buildResult({ id: "incompatible", environment: { webllmVersion: "0.2.85" } });

    const filtered = filterUsableModelBenchmarkResults([usable, expired, incompatible], MATCHING_CONTEXT, now);
    expect(filtered).toEqual([usable]);
  });
});

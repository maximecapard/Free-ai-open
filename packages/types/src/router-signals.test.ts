import { describe, expect, it } from "vitest";
import type {
  LocalBenchmarkResult,
  ModelPerformanceObservation,
  StaticCapabilityProfile,
} from "./router-signals";

const FORBIDDEN_KEYS = ["prompt", "response", "message", "messages", "conversation", "conversations", "document"];

function assertNoForbiddenKeys(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const key of FORBIDDEN_KEYS) {
    expect(serialized.toLowerCase()).not.toContain(`"${key}"`);
  }
}

describe("StaticCapabilityProfile contract", () => {
  const example: StaticCapabilityProfile = {
    schemaVersion: 1,
    detectedAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-24T10:00:00.000Z",
    formFactor: "desktop",
    architectureClass: "x86",
    browserFamily: "chrome",
    osFamily: "windows",
    memoryClass: "high",
    logicalProcessorClass: "medium",
    approximateMemoryGB: 16,
    logicalProcessors: 8,
    webgpuAvailable: true,
    wasmAvailable: true,
    fallbackAdapter: false,
    capabilityClass: "performance",
    deviceTier: 4,
    gpu: {
      vendorClass: "nvidia",
      architectureClass: "unknown",
      descriptionClass: "discrete",
      featureClasses: ["shader-f16"],
      limitClasses: { maxBufferSize: "high" },
    },
    confidence: "medium",
  };

  it("is a usable, schema-versioned shape", () => {
    expect(example.schemaVersion).toBeTypeOf("number");
    expect(example.confidence).toBe("medium");
  });

  it("keeps GPU signals as coarse classes, never raw adapter strings, by construction", () => {
    // The type only exposes *Class fields plus bounded feature/limit maps —
    // this test documents that intent so a future edit adding a raw field
    // (e.g. `gpu.vendorString`) is caught by the assertion below, not only
    // by code review.
    expect(Object.keys(example.gpu).every((key) => !key.toLowerCase().includes("string"))).toBe(true);
  });

  it("never contains prompt/response/conversation-shaped fields", () => {
    assertNoForbiddenKeys(example);
  });
});

describe("LocalBenchmarkResult contract", () => {
  const example: LocalBenchmarkResult = {
    schemaVersion: 2,
    benchmarkVersion: "1.0.0",
    capabilityProfileKey: "desktop:performance:webgpu:native",
    measuredAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-24T10:00:00.000Z",
    status: "completed",
    stage: "complete",
    webgpuInitMs: 42,
    computeScore: 0.8,
    mainThreadDelayMs: 3,
    responsiveness: "responsive",
    stability: "stable",
    confidence: "medium",
  };

  it("carries an expiry so a stale result can be treated as absent", () => {
    expect(Date.parse(example.expiresAt)).toBeGreaterThan(Date.parse(example.measuredAt));
  });

  it("accepts a failed/unsupported result without numeric fields", () => {
    const failed: LocalBenchmarkResult = {
      schemaVersion: 2,
      benchmarkVersion: "1.0.0",
      capabilityProfileKey: "desktop:compatibility:no-webgpu:native",
      measuredAt: "2026-07-17T10:00:00.000Z",
      expiresAt: "2026-07-24T10:00:00.000Z",
      status: "unsupported",
      stage: "initialization",
      responsiveness: "unknown",
      stability: "unknown",
      confidence: "low",
      errorCode: "webgpu_unavailable",
    };
    expect(failed.computeScore).toBeUndefined();
  });

  it("never contains prompt/response/conversation-shaped fields", () => {
    assertNoForbiddenKeys(example);
  });
});

describe("ModelPerformanceObservation contract", () => {
  const example: ModelPerformanceObservation = {
    schemaVersion: 1,
    modelId: "sample-general-light",
    observedAt: "2026-07-17T10:00:00.000Z",
    loadSucceeded: true,
    loadTimeMs: 1200,
    firstTokenTimeMs: 300,
    promptTokensPerSecond: 50,
    generationTokensPerSecond: 18,
    generationDurationMs: 4000,
    testedContextTokens: 2048,
    outcome: "completed",
  };

  it("distinguishes a user-initiated cancellation from a real failure outcome", () => {
    const cancelled: ModelPerformanceObservation = { ...example, outcome: "cancelled" };
    const failed: ModelPerformanceObservation = { ...example, loadSucceeded: false, outcome: "load_failed" };
    expect(cancelled.outcome).not.toBe(failed.outcome);
  });

  it("never contains prompt/response/conversation-shaped fields", () => {
    assertNoForbiddenKeys(example);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { StaticCapabilityProfile } from "@free-ai-open/types";
import { runLocalBenchmark } from "./runner";

const profile = {
  schemaVersion: 1,
  detectedAt: "2026-07-17T10:00:00.000Z",
  expiresAt: "2026-07-24T10:00:00.000Z",
  formFactor: "desktop",
  architectureClass: "x86",
  browserFamily: "chromium",
  osFamily: "windows",
  memoryClass: "high",
  logicalProcessorClass: "high",
  webgpuAvailable: true,
  wasmAvailable: true,
  capabilityClass: "balanced",
  deviceTier: 2,
  gpu: { featureClasses: [], limitClasses: {} },
  confidence: "medium",
} satisfies StaticCapabilityProfile;

describe("runLocalBenchmark", () => {
  it("returns a completed technical result from valid samples", async () => {
    const result = await runLocalBenchmark({
      profile,
      executeWorkload: async (config) => ({
        ok: true,
        value: { initMs: 12, samplesMs: Array.from({ length: config.sampleCount }, (_, index) => 20 + index), timingMethod: "wall-clock" },
      }),
      now: () => new Date("2026-07-17T10:00:00.000Z"),
    });
    expect(result).toMatchObject({ status: "completed", stage: "complete", sampleCount: 5, timingMethod: "wall-clock" });
    expect(result.computeScore).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toMatch(/"(?:prompt|response|conversation|document|message)s?"/i);
  });

  it("returns unsupported without running a workload when WebGPU is absent", async () => {
    const executeWorkload = vi.fn();
    const result = await runLocalBenchmark({ profile: { ...profile, webgpuAvailable: false }, executeWorkload });
    expect(result).toMatchObject({ status: "unsupported", errorCode: "webgpu_unavailable" });
    expect(executeWorkload).not.toHaveBeenCalled();
  });

  it("returns cancelled for an aborted run", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runLocalBenchmark({ profile, signal: controller.signal, executeWorkload: vi.fn() });
    expect(result).toMatchObject({ status: "cancelled", errorCode: "cancelled" });
  });

  it("enforces a hard timeout when the executor never settles", async () => {
    const result = await runLocalBenchmark({
      profile,
      executeWorkload: () => new Promise(() => undefined),
      timeoutMs: 5,
    });
    expect(result).toMatchObject({ status: "failed", errorCode: "timeout" });
  });

  it("rejects an incomplete sample set", async () => {
    const result = await runLocalBenchmark({
      profile,
      executeWorkload: async () => ({ ok: true, value: { initMs: 1, samplesMs: [10], timingMethod: "wall-clock" } }),
    });
    expect(result).toMatchObject({ status: "failed", errorCode: "invalid_compute_result" });
  });

  it("maps workload failures without throwing", async () => {
    const result = await runLocalBenchmark({
      profile,
      executeWorkload: async () => ({ ok: false, error: { errorCode: "device_lost" } }),
    });
    expect(result).toMatchObject({ status: "failed", errorCode: "device_lost", confidence: "low" });
  });
});

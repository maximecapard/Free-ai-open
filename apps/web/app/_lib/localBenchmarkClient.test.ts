import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalBenchmarkResult, StaticCapabilityProfile } from "@free-ai-open/types";

const mocks = vi.hoisted(() => ({
  runLocalBenchmark: vi.fn(),
  getStored: vi.fn(),
  setStored: vi.fn(),
  addLocalLog: vi.fn(async () => undefined),
}));

vi.mock("@free-ai-open/local-benchmark", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@free-ai-open/local-benchmark")>()),
  runLocalBenchmark: mocks.runLocalBenchmark,
}));
vi.mock("./benchmarkResultStore", () => ({
  getStoredLocalBenchmarkForProfile: mocks.getStored,
  setStoredLocalBenchmarkResult: mocks.setStored,
}));
vi.mock("@free-ai-open/local-logs", () => ({ addLocalLog: mocks.addLocalLog }));

import { runAndStoreLocalBenchmark } from "./localBenchmarkClient";

const profile = { webgpuAvailable: true } as StaticCapabilityProfile;
const result = {
  schemaVersion: 2,
  benchmarkVersion: "1.0.0",
  capabilityProfileKey: "desktop:balanced:webgpu:native",
  measuredAt: "2026-07-17T10:00:00.000Z",
  expiresAt: "2026-07-24T10:00:00.000Z",
  status: "completed",
  stage: "complete",
  computeScore: 70,
  durationMs: 100,
  responsiveness: "responsive",
  stability: "stable",
  confidence: "medium",
} satisfies LocalBenchmarkResult;

describe("local benchmark browser coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runLocalBenchmark.mockResolvedValue(result);
  });

  it("uses a valid cached result without rerunning", async () => {
    mocks.getStored.mockReturnValue(result);
    await expect(runAndStoreLocalBenchmark(profile)).resolves.toEqual({ result, source: "cache" });
    expect(mocks.runLocalBenchmark).not.toHaveBeenCalled();
  });

  it("force-runs and replaces the cached result", async () => {
    mocks.getStored.mockReturnValue(result);
    await runAndStoreLocalBenchmark(profile, { force: true });
    expect(mocks.runLocalBenchmark).toHaveBeenCalledOnce();
    expect(mocks.setStored).toHaveBeenCalledWith(result);
  });

  it("logs only technical benchmark events and duration", async () => {
    mocks.getStored.mockReturnValue(null);
    await runAndStoreLocalBenchmark(profile);
    expect(mocks.addLocalLog).toHaveBeenCalledWith({ event: "benchmark.started", severity: "info" });
    const serialized = JSON.stringify(mocks.addLocalLog.mock.calls);
    expect(serialized).not.toMatch(/"(?:prompt|response|conversation|document|message)s?"/i);
    expect(serialized).not.toContain("capabilityProfileKey");
  });
});

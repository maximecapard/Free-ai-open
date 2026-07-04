import { describe, expect, it } from "vitest";
import type { LocalLogRecord } from "@free-ai-open/local-logs";
import {
  findGenerationMetrics,
  findLastRuntimeStatus,
  findLoadTimeMs,
  findLoadedModelId,
  toRecentErrors,
} from "./debugDiagnostics";

function log(overrides: Partial<LocalLogRecord> & Pick<LocalLogRecord, "id" | "event" | "severity" | "timestamp">): LocalLogRecord {
  return overrides;
}

describe("findLoadedModelId", () => {
  it("returns the modelId of the most recent model.load.completed entry", () => {
    const logs: LocalLogRecord[] = [
      log({ id: "2", event: "inference.started", severity: "info", timestamp: "2026-01-01T00:01:00.000Z" }),
      log({ id: "1", event: "model.load.completed", severity: "info", timestamp: "2026-01-01T00:00:00.000Z", modelId: "sample-general-light" }),
    ];

    expect(findLoadedModelId(logs)).toBe("sample-general-light");
  });

  it("returns null when no model has been loaded", () => {
    expect(findLoadedModelId([])).toBeNull();
  });
});

describe("findLastRuntimeStatus", () => {
  it("returns the most recent entry that carries a runtimeStatus", () => {
    const logs: LocalLogRecord[] = [
      log({ id: "2", event: "inference.completed", severity: "info", timestamp: "2026-01-01T00:01:00.000Z", runtimeStatus: "ready" }),
      log({ id: "1", event: "model.load.completed", severity: "info", timestamp: "2026-01-01T00:00:00.000Z", runtimeStatus: "ready" }),
    ];

    expect(findLastRuntimeStatus(logs)).toEqual({ status: "ready", timestamp: "2026-01-01T00:01:00.000Z" });
  });

  it("returns null when no session has been recorded", () => {
    expect(findLastRuntimeStatus([])).toBeNull();
  });
});

describe("findLoadTimeMs", () => {
  it("returns the loadTimeMs from the most recent entry that has one", () => {
    const logs: LocalLogRecord[] = [
      log({
        id: "1",
        event: "model.load.completed",
        severity: "info",
        timestamp: "2026-01-01T00:00:00.000Z",
        performanceMetrics: { loadTimeMs: 1200 },
      }),
    ];

    expect(findLoadTimeMs(logs)).toBe(1200);
  });

  it("returns undefined when no load time has been recorded", () => {
    expect(findLoadTimeMs([])).toBeUndefined();
  });
});

describe("findGenerationMetrics", () => {
  it("returns firstTokenMs, tokensPerSecond, and generationDurationMs from the most recent generation entry", () => {
    const logs: LocalLogRecord[] = [
      log({
        id: "1",
        event: "inference.completed",
        severity: "info",
        timestamp: "2026-01-01T00:00:00.000Z",
        performanceMetrics: { firstTokenMs: 240, tokensPerSecond: 18, totalTimeMs: 3200 },
      }),
    ];

    expect(findGenerationMetrics(logs)).toEqual({ firstTokenMs: 240, tokensPerSecond: 18, generationDurationMs: 3200 });
  });

  it("returns null when no generation has completed yet", () => {
    expect(findGenerationMetrics([])).toBeNull();
  });
});

describe("toRecentErrors", () => {
  it("keeps only warn/error/critical entries and maps them to DiagnosticError shape", () => {
    const logs: LocalLogRecord[] = [
      log({ id: "1", event: "model.load.completed", severity: "info", timestamp: "2026-01-01T00:00:00.000Z" }),
      log({
        id: "2",
        event: "model.load.failed",
        severity: "error",
        timestamp: "2026-01-01T00:01:00.000Z",
        modelId: "sample-general-light",
        backend: "webgpu",
        errorCode: "MODEL_LOAD_FAILED",
      }),
    ];

    expect(toRecentErrors(logs)).toEqual([
      {
        event: "model.load.failed",
        severity: "error",
        timestamp: "2026-01-01T00:01:00.000Z",
        modelId: "sample-general-light",
        backend: "webgpu",
        errorCode: "MODEL_LOAD_FAILED",
      },
    ]);
  });

  it("never includes prompt/response content since LocalLogRecord cannot carry it", () => {
    const logs: LocalLogRecord[] = [
      log({ id: "1", event: "inference.failed", severity: "error", timestamp: "2026-01-01T00:00:00.000Z", errorCode: "OOM" }),
    ];

    expect(JSON.stringify(toRecentErrors(logs))).not.toMatch(/prompt|response/i);
  });
});

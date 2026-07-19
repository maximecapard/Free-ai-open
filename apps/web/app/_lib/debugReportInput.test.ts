import { describe, expect, it } from "vitest";
import { buildDiagnosticReport } from "@free-ai-open/diagnostic-report";
import type { LocalLogRecord } from "@free-ai-open/local-logs";
import { buildDebugDiagnosticReportInput } from "./debugReportInput";

const now = () => new Date("2026-07-04T12:00:00.000Z");

describe("buildDebugDiagnosticReportInput", () => {
  it("adds top-level technical metrics from local logs", () => {
    const logs: LocalLogRecord[] = [
      {
        id: "generation",
        event: "inference.completed",
        severity: "info",
        timestamp: "2026-07-04T11:59:00.000Z",
        performanceMetrics: {
          firstTokenMs: 240,
          tokensPerSecond: 18,
          totalTimeMs: 3200,
        },
      },
      {
        id: "load",
        event: "model.load.completed",
        severity: "info",
        timestamp: "2026-07-04T11:58:00.000Z",
        performanceMetrics: {
          loadTimeMs: 1200,
        },
      },
    ];

    const report = buildDiagnosticReport(
      buildDebugDiagnosticReportInput({
        appVersion: "0.0.1",
        deviceProfile: null,
        routeResult: null,
        mode: "balanced",
        logs,
      }),
      { now }
    );

    expect(report.contentLogged).toBe(false);
    expect(report.metrics).toEqual({
      modelLoadTimeMs: 1200,
      firstTokenTimeMs: 240,
      tokensPerSecond: 18,
      generationDurationMs: 3200,
    });
  });

  it("keeps exported reports free of private fields even when unsafe log-like data is passed", () => {
    const logs = [
      {
        id: "generation",
        event: "inference.completed",
        severity: "info",
        timestamp: "2026-07-04T11:59:00.000Z",
        prompt: "private prompt",
        response: "private response",
        messages: ["private message"],
        conversation: "private conversation",
        document: "private document",
        userText: "private user text",
        inputText: "private input text",
        outputText: "private output text",
        performanceMetrics: {
          firstTokenMs: 240,
          tokensPerSecond: 18,
          totalTimeMs: 3200,
        },
      },
    ] as unknown as LocalLogRecord[];

    const report = buildDiagnosticReport(
      buildDebugDiagnosticReportInput({
        deviceProfile: null,
        routeResult: null,
        mode: "balanced",
        logs,
      }),
      { now }
    );
    const serialized = JSON.stringify(report);

    expect(report.contentLogged).toBe(false);
    for (const forbidden of [
      "prompt",
      "response",
      "messages",
      "conversation",
      "document",
      "userText",
      "inputText",
      "outputText",
      "private",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("prefers the current runtime and adaptive-router values over stale log history", () => {
    const logs: LocalLogRecord[] = [
      {
        id: "stale-runtime",
        event: "model.load.completed",
        severity: "info",
        timestamp: "2026-07-04T10:00:00.000Z",
        runtimeStatus: "ready",
        modelId: "old-model",
      },
    ];

    const report = buildDiagnosticReport(
      buildDebugDiagnosticReportInput({
        deviceProfile: null,
        routeResult: null,
        mode: "performance",
        runtimeStatus: "recovering",
        task: "coding",
        recommendedModelId: "qwen3-4b-q4f16",
        loadedModelId: "qwen3-1.7b-q4f16",
        logs,
      }),
      { now }
    );

    expect(report).toMatchObject({
      contentLogged: false,
      runtimeStatus: "recovering",
      performanceMode: "performance",
      task: "coding",
      recommendedModelId: "qwen3-4b-q4f16",
      loadedModelId: "qwen3-1.7b-q4f16",
    });
  });
});

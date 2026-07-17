import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  copyDiagnosticReportToClipboardData,
  exportDiagnosticReportAsJson,
  validateDiagnosticReportPrivacy,
} from "./index";
import type { DiagnosticReportInput } from "./types";

const now = () => new Date("2026-07-04T12:00:00.000Z");

describe("diagnostic report", () => {
  it("builds a local technical report from available runtime context", () => {
    const report = buildDiagnosticReport(
      {
        appVersion: "0.0.1",
        runtimeStatus: "ready",
        backend: "webgpu",
        webgpuAvailable: true,
        deviceTier: 3,
        performanceMode: "balanced",
        task: "chat",
        recommendedModelId: "sample-general-light",
        loadedModelId: "sample-general-light",
        cacheState: {
          status: "available",
          estimatedUsageBytes: 128,
          estimatedQuotaBytes: 1024,
        },
        recentErrors: [
          {
            event: "model.load.failed",
            severity: "error",
            timestamp: "2026-07-04T11:58:00.000Z",
            modelId: "sample-general-light",
            backend: "webgpu",
            errorCode: "MODEL_LOAD_FAILED",
          },
        ],
        localLogs: [
          {
            id: "log-1",
            event: "inference.completed",
            severity: "info",
            timestamp: "2026-07-04T11:59:00.000Z",
            modelId: "sample-general-light",
            backend: "webgpu",
            runtimeStatus: "ready",
            performanceMetrics: {
              loadTimeMs: 1200,
              firstTokenMs: 240,
              tokensPerSecond: 18,
              totalTimeMs: 3200,
            },
          },
        ],
        metrics: {
          modelLoadTimeMs: 1200,
          firstTokenTimeMs: 240,
          tokensPerSecond: 18,
          generationDurationMs: 3200,
        },
        browserInfo: {
          browserFamily: "chromium",
          osFamily: "windows",
        },
      },
      { now }
    );

    expect(report).toEqual({
      generatedAt: "2026-07-04T12:00:00.000Z",
      contentLogged: false,
      appVersion: "0.0.1",
      runtimeStatus: "ready",
      backend: "webgpu",
      webgpuAvailable: true,
      deviceTier: 3,
      performanceMode: "balanced",
      task: "chat",
      recommendedModelId: "sample-general-light",
      loadedModelId: "sample-general-light",
      cacheState: {
        status: "available",
        estimatedUsageBytes: 128,
        estimatedQuotaBytes: 1024,
      },
      recentErrors: [
        {
          event: "model.load.failed",
          severity: "error",
          timestamp: "2026-07-04T11:58:00.000Z",
          modelId: "sample-general-light",
          backend: "webgpu",
          errorCode: "MODEL_LOAD_FAILED",
        },
      ],
      localLogs: [
        {
          event: "inference.completed",
          severity: "info",
          timestamp: "2026-07-04T11:59:00.000Z",
          modelId: "sample-general-light",
          backend: "webgpu",
          runtimeStatus: "ready",
          performanceMetrics: {
            modelLoadTimeMs: 1200,
            firstTokenTimeMs: 240,
            tokensPerSecond: 18,
            generationDurationMs: 3200,
          },
        },
      ],
      metrics: {
        modelLoadTimeMs: 1200,
        firstTokenTimeMs: 240,
        tokensPerSecond: 18,
        generationDurationMs: 3200,
      },
      browserInfo: {
        browserFamily: "chromium",
        osFamily: "windows",
      },
    });
  });

  it("preserves the cancelling runtime status, at the top level and in local logs", () => {
    const report = buildDiagnosticReport(
      {
        runtimeStatus: "cancelling",
        localLogs: [
          {
            id: "log-1",
            event: "inference.cancel.requested",
            severity: "info",
            timestamp: "2026-07-04T11:59:00.000Z",
            modelId: "sample-general-light",
            runtimeStatus: "cancelling",
          },
        ],
      },
      { now }
    );

    expect(report.runtimeStatus).toBe("cancelling");
    expect(report.localLogs).toEqual([
      {
        event: "inference.cancel.requested",
        severity: "info",
        timestamp: "2026-07-04T11:59:00.000Z",
        modelId: "sample-general-light",
        runtimeStatus: "cancelling",
      },
    ]);
    expect(report.contentLogged).toBe(false);
    expect(validateDiagnosticReportPrivacy(report)).toEqual({ valid: true, violations: [] });
  });

  it("preserves the recovering runtime status, at the top level and in local logs", () => {
    const report = buildDiagnosticReport(
      {
        runtimeStatus: "recovering",
        localLogs: [
          {
            id: "log-1",
            event: "runtime.recovery.started",
            severity: "info",
            timestamp: "2026-07-04T11:59:00.000Z",
            modelId: "sample-general-light",
            runtimeStatus: "recovering",
          },
        ],
      },
      { now }
    );

    expect(report.runtimeStatus).toBe("recovering");
    expect(report.localLogs).toEqual([
      {
        event: "runtime.recovery.started",
        severity: "info",
        timestamp: "2026-07-04T11:59:00.000Z",
        modelId: "sample-general-light",
        runtimeStatus: "recovering",
      },
    ]);
    expect(report.contentLogged).toBe(false);
    expect(validateDiagnosticReportPrivacy(report)).toEqual({ valid: true, violations: [] });
  });

  it("derives technical fields from device profile and router result", () => {
    const report = buildDiagnosticReport(
      {
        deviceProfile: {
          webgpuAvailable: false,
          wasmAvailable: true,
          preferredBackend: "wasm",
          browserFamily: "firefox",
          osFamily: "linux",
          benchmark: { status: "skipped", score: null, reason: "placeholder" },
          deviceTier: 1,
          deviceTierLabel: "webgpu_low",
          formFactor: "desktop",
          architectureClass: "unknown",
          memoryClass: "medium",
          cpuConcurrencyClass: "medium",
          capabilityClass: "light",
        },
        routerResult: {
          selectedModel: { id: "sample-general-light" },
          fallbackModel: null,
        },
      } as DiagnosticReportInput,
      { now }
    );

    expect(report).toMatchObject({
      backend: "wasm",
      webgpuAvailable: false,
      deviceTier: 1,
      recommendedModelId: "sample-general-light",
      browserInfo: {
        browserFamily: "firefox",
        osFamily: "linux",
      },
      contentLogged: false,
    });
  });

  it("includes only coarse static capability profile fields in diagnostics", () => {
    const report = buildDiagnosticReport(
      {
        capabilityProfile: {
          schemaVersion: 2,
          detectedAt: "2026-07-17T10:00:00.000Z",
          expiresAt: "2026-07-24T10:00:00.000Z",
          formFactor: "desktop",
          architectureClass: "x86",
          browserFamily: "chromium",
          osFamily: "windows",
          memoryClass: "high",
          logicalProcessorClass: "high",
          approximateMemoryGB: 16,
          logicalProcessors: 12,
          webgpuAvailable: true,
          wasmAvailable: true,
          fallbackAdapter: false,
          capabilityClass: "performance",
          deviceTier: 4,
          gpu: {
            vendorClass: "nvidia",
            architectureClass: "nvidia-modern",
            descriptionClass: "discrete",
            featureClasses: ["shader-f16"],
            limitClasses: { maxBufferSize: "very_high" },
            experimentalMemoryClass: "8gb_plus",
            experimentalMemoryConfidence: "low",
            vendorString: "NVIDIA GeForce RTX 4090 raw driver text",
          },
          confidence: "high",
          rawDescription: "NVIDIA GeForce RTX 4090 raw driver text",
        } as unknown as DiagnosticReportInput["capabilityProfile"],
      },
      { now }
    );

    expect(report.capabilityProfile).toEqual({
      schemaVersion: 2,
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
      fallbackAdapter: false,
      capabilityClass: "performance",
      deviceTier: 4,
      confidence: "high",
      gpu: {
        vendorClass: "nvidia",
        architectureClass: "nvidia-modern",
        descriptionClass: "discrete",
        featureClasses: ["shader-f16"],
        limitClasses: { maxBufferSize: "very_high" },
        experimentalMemoryClass: "8gb_plus",
        experimentalMemoryConfidence: "low",
      },
    });
    expect(JSON.stringify(report)).not.toContain("4090");
    expect(JSON.stringify(report)).not.toContain("raw driver");
    expect(validateDiagnosticReportPrivacy(report)).toEqual({ valid: true, violations: [] });
  });

  it("does not include prompt, response, document, messages, or user text fields", () => {
    const unsafeInput = {
      event: "diagnostic.export",
      appVersion: "0.0.1",
      runtimeStatus: "ready",
      prompt: "private prompt",
      response: "private response",
      document: "private document",
      documentContent: "private document content",
      messages: ["private message"],
      conversation: "private conversation",
      userText: "private user text",
      inputText: "private input text",
      outputText: "private output text",
      chatHistory: "private chat history",
      conversations: [
        {
          messages: [
            { role: "user", content: "private stored conversation prompt" },
            { role: "assistant", content: "private stored conversation response" },
          ],
        },
      ],
      localLogs: [
        {
          id: "log-1",
          event: "inference.completed",
          severity: "info",
          timestamp: "2026-07-04T11:59:00.000Z",
          prompt: "private nested prompt",
          response: "private nested response",
          modelId: "sample-general-light",
        },
      ],
      recentErrors: [
        {
          severity: "error",
          errorCode: "The user asked about a private contract",
        },
      ],
    } as unknown as DiagnosticReportInput;

    const report = buildDiagnosticReport(unsafeInput, { now });
    const serialized = JSON.stringify(report);

    expect(report.contentLogged).toBe(false);
    expect(validateDiagnosticReportPrivacy(report)).toEqual({ valid: true, violations: [] });
    for (const forbidden of [
      "prompt",
      "response",
      "document",
      "documentContent",
      "messages",
      "conversation",
      "userText",
      "inputText",
      "outputText",
      "chatHistory",
      "conversations",
      "private stored conversation",
      "private",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("drops conversation-shaped input without exporting conversation or message keys", () => {
    const report = buildDiagnosticReport(
      {
        runtimeStatus: "ready",
        conversations: [
          {
            id: "conversation-1",
            messages: [
              { role: "user", content: "private local question" },
              { role: "assistant", content: "private local answer" },
            ],
          },
        ],
        conversation: {
          messages: [{ role: "user", content: "private active conversation" }],
        },
        messages: [{ role: "user", content: "private current message" }],
      } as unknown as DiagnosticReportInput,
      { now }
    );
    const serialized = JSON.stringify(report);

    expect(report.contentLogged).toBe(false);
    expect(validateDiagnosticReportPrivacy(report)).toEqual({ valid: true, violations: [] });
    expect(serialized).not.toMatch(/"conversation"|"conversations"|"messages"/);
    expect(serialized).not.toContain("private local question");
    expect(serialized).not.toContain("private local answer");
    expect(serialized).not.toContain("private active conversation");
    expect(serialized).not.toContain("private current message");
  });

  it("forces contentLogged to false even if unsafe input says otherwise", () => {
    const report = buildDiagnosticReport({ contentLogged: true } as DiagnosticReportInput, { now });

    expect(report.contentLogged).toBe(false);
  });

  it("rejects reports that contain forbidden privacy fields", () => {
    const result = validateDiagnosticReportPrivacy({
      generatedAt: "2026-07-04T12:00:00.000Z",
      contentLogged: false,
      prompt: "private prompt",
      nested: { outputText: "private output" },
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["report.prompt", "report.nested.outputText"]);
  });

  it("exports stable JSON and clipboard data without user content", () => {
    const input = {
      appVersion: "0.0.1",
      runtimeStatus: "error",
      recentErrors: [{ severity: "error", errorCode: "MODEL_LOAD_FAILED" }],
      response: "private response",
    } as DiagnosticReportInput;

    const json = exportDiagnosticReportAsJson(input, { now });
    const clipboardData = copyDiagnosticReportToClipboardData(input, { now });

    expect(JSON.parse(json)).toMatchObject({
      generatedAt: "2026-07-04T12:00:00.000Z",
      contentLogged: false,
      runtimeStatus: "error",
      recentErrors: [{ severity: "error", errorCode: "MODEL_LOAD_FAILED" }],
    });
    expect(json).not.toContain("private response");
    expect(clipboardData["application/json"]).toBe(json);
    expect(clipboardData["text/plain"]).toBe(json);
  });

  it("limits recent errors and logs", () => {
    const report = buildDiagnosticReport(
      {
        recentErrors: [
          { severity: "error", errorCode: "ERROR_ONE" },
          { severity: "warn", errorCode: "ERROR_TWO" },
        ],
        localLogs: [
          { id: "1", event: "model.load.started", severity: "info", timestamp: "2026-07-04T11:00:00.000Z" },
          { id: "2", event: "model.load.completed", severity: "info", timestamp: "2026-07-04T11:01:00.000Z" },
        ],
      },
      { now, maxErrors: 1, maxLogs: 1 }
    );

    expect(report.recentErrors).toEqual([{ severity: "error", errorCode: "ERROR_ONE" }]);
    expect(report.localLogs).toEqual([
      { event: "model.load.started", severity: "info", timestamp: "2026-07-04T11:00:00.000Z" },
    ]);
  });
});

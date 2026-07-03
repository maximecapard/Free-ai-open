import { describe, expect, it } from "vitest";
import { telemetryEventSchema } from "./schema";

describe("telemetryEventSchema", () => {
  it("accepts a minimal valid event", () => {
    const result = telemetryEventSchema.safeParse({
      event: "model.load-completed",
      severity: "info",
      contentLogged: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated valid event", () => {
    const result = telemetryEventSchema.safeParse({
      event: "model.router.decision",
      severity: "info",
      appVersion: "0.0.1",
      backend: "webgpu",
      browserFamily: "chromium",
      osFamily: "windows",
      deviceTier: 2,
      performanceMode: "balanced",
      task: "chat",
      modelId: "sample-general-light",
      loadTimeMs: 1200,
      firstTokenMs: 340,
      tokensPerSecond: 18.5,
      fallbackAttempted: false,
      fallbackResult: "not_attempted",
      promptLength: 42,
      responseLength: 128,
      contentLogged: false,
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts a technical telemetry event with strict fields", () => {
    const result = telemetryEventSchema.safeParse({
      event: "webgpu.device-lost",
      severity: "error",
      task: "document_analysis",
      modelId: "sample_general.light-v1",
      errorCode: "GPU_DEVICE_LOST",
      contentLogged: false,
      timestamp: "2026-07-04T12:34:56.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts telemetry task categories from the shared task list", () => {
    expect(
      telemetryEventSchema.safeParse({
        event: "router.task-selected",
        severity: "info",
        task: "rewrite",
        contentLogged: false,
      }).success
    ).toBe(true);

    expect(
      telemetryEventSchema.safeParse({
        event: "router.task-selected",
        severity: "info",
        task: "document_analysis",
        contentLogged: false,
      }).success
    ).toBe(true);
  });

  it("rejects hyphenated document-analysis because task categories use underscores", () => {
    const result = telemetryEventSchema.safeParse({
      event: "router.task-selected",
      severity: "info",
      task: "document-analysis",
      contentLogged: false,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a prompt placed in event", () => {
    const result = telemetryEventSchema.safeParse({
      event: "Please summarize this private email for me",
      severity: "info",
      contentLogged: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a response placed in errorCode", () => {
    const result = telemetryEventSchema.safeParse({
      event: "inference.failed",
      severity: "error",
      errorCode: "Here is the answer to your question",
      contentLogged: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects document content placed in an allowed technical field", () => {
    const result = telemetryEventSchema.safeParse({
      event: "document.analysis-failed",
      severity: "error",
      errorCode: "Confidential uploaded document text",
      contentLogged: false,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a natural-language phrase in modelId", () => {
    const result = telemetryEventSchema.safeParse({
      event: "model.load-failed",
      severity: "warn",
      modelId: "the helpful model selected by the user",
      contentLogged: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid timestamp", () => {
    const result = telemetryEventSchema.safeParse({
      event: "telemetry.received",
      severity: "info",
      contentLogged: false,
      timestamp: "July 4th at noon",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid ISO timestamp", () => {
    const result = telemetryEventSchema.safeParse({
      event: "telemetry.received",
      severity: "info",
      contentLogged: false,
      timestamp: "2026-07-04T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects forbidden content-bearing fields via strict mode", () => {
    const result = telemetryEventSchema.safeParse({
      event: "chat.completed",
      severity: "info",
      contentLogged: false,
      prompt: "this should never be here",
    });
    expect(result.success).toBe(false);
  });

  it("rejects all forbidden content-bearing field names", () => {
    for (const field of ["prompt", "response", "document", "messages", "chatHistory"]) {
      const result = telemetryEventSchema.safeParse({
        event: "telemetry.received",
        severity: "info",
        contentLogged: false,
        [field]: "private content",
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects contentLogged: true", () => {
    const result = telemetryEventSchema.safeParse({
      event: "chat.completed",
      severity: "info",
      contentLogged: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid severity value", () => {
    const result = telemetryEventSchema.safeParse({
      event: "chat.completed",
      severity: "verbose",
      contentLogged: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = telemetryEventSchema.safeParse({ severity: "info" });
    expect(result.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { telemetryEventSchema } from "./schema";

describe("telemetryEventSchema", () => {
  it("accepts a minimal valid event", () => {
    const result = telemetryEventSchema.safeParse({
      event: "model_load_completed",
      severity: "info",
      contentLogged: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated valid event", () => {
    const result = telemetryEventSchema.safeParse({
      event: "inference_completed",
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

  it("rejects forbidden content-bearing fields via strict mode", () => {
    const result = telemetryEventSchema.safeParse({
      event: "chat_completed",
      severity: "info",
      contentLogged: false,
      prompt: "this should never be here",
    });
    expect(result.success).toBe(false);
  });

  it("rejects contentLogged: true", () => {
    const result = telemetryEventSchema.safeParse({
      event: "chat_completed",
      severity: "info",
      contentLogged: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid severity value", () => {
    const result = telemetryEventSchema.safeParse({
      event: "chat_completed",
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

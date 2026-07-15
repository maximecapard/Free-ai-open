import { describe, expect, it, vi } from "vitest";
import { getRuntimeLanguageInstruction } from "@free-ai-open/ai-runtime";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  createLogEvent: vi.fn((event: string, severity: string, data?: Record<string, unknown>) => ({
    event,
    severity,
    data,
    contentLogged: false as const,
  })),
  addLocalLog: vi.fn(),
}));

vi.mock("@free-ai-open/logger", () => ({
  logEvent: mocks.logEvent,
  createLogEvent: mocks.createLogEvent,
}));

vi.mock("@free-ai-open/local-logs", () => ({
  addLocalLog: mocks.addLocalLog,
}));

const { recordRuntimeRecoveryEvent } = await import("./runtimeRecovery");

describe("runtime recovery logging", () => {
  it("records recovery lifecycle events as technical-only local logs", () => {
    recordRuntimeRecoveryEvent("runtime.recovery.started", "info", "recovering");
    recordRuntimeRecoveryEvent("runtime.recovery.completed", "info", "ready");
    recordRuntimeRecoveryEvent("runtime.recovery.failed", "error", "error", "RUNTIME_RECOVERY_FAILED");

    expect(mocks.addLocalLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "runtime.recovery.started", runtimeStatus: "recovering" })
    );
    expect(mocks.addLocalLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "runtime.recovery.completed", runtimeStatus: "ready" })
    );
    expect(mocks.addLocalLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "runtime.recovery.failed",
        runtimeStatus: "error",
        errorCode: "RUNTIME_RECOVERY_FAILED",
      })
    );

    const serialized = JSON.stringify([...mocks.createLogEvent.mock.calls, ...mocks.addLocalLog.mock.calls]);
    expect(serialized).not.toMatch(/prompt|response|conversation|document|messages|userText|inputText|outputText/);
    expect(serialized).not.toContain(getRuntimeLanguageInstruction("fr"));
    expect(serialized).not.toContain(getRuntimeLanguageInstruction("en"));
  });
});

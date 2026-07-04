import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogEvent, logEvent } from "./index";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEBUG_FLAG = process.env.NEXT_PUBLIC_DEBUG_LOGS;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.NEXT_PUBLIC_DEBUG_LOGS = ORIGINAL_DEBUG_FLAG;
  vi.restoreAllMocks();
});

describe("createLogEvent", () => {
  it("always marks contentLogged as false", () => {
    const event = createLogEvent("router_decision", "info", { task: "chat" });
    expect(event.contentLogged).toBe(false);
    expect(event.data).toEqual({ task: "chat" });
  });

  it("redacts runtime content fields before creating a log event", () => {
    const event = createLogEvent("inference.completed", "info", {
      prompt: "private prompt",
      response: "private response",
      messages: ["private message"],
      conversation: "private conversation",
      document: "private document",
      userText: "private user text",
      inputText: "private input text",
      outputText: "private output text",
      chatHistory: "private chat history",
      modelId: "sample-general-light",
    });

    expect(event.contentLogged).toBe(false);
    expect(event.data).toMatchObject({
      prompt: "[FORBIDDEN_FIELD_REMOVED]",
      response: "[FORBIDDEN_FIELD_REMOVED]",
      messages: "[FORBIDDEN_FIELD_REMOVED]",
      conversation: "[FORBIDDEN_FIELD_REMOVED]",
      document: "[FORBIDDEN_FIELD_REMOVED]",
      userText: "[FORBIDDEN_FIELD_REMOVED]",
      inputText: "[FORBIDDEN_FIELD_REMOVED]",
      outputText: "[FORBIDDEN_FIELD_REMOVED]",
      chatHistory: "[FORBIDDEN_FIELD_REMOVED]",
      modelId: "sample-general-light",
    });
    expect(JSON.stringify(event)).not.toContain("private");
  });
});

describe("logEvent", () => {
  it("logs to the console outside of production", () => {
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_DEBUG_LOGS = undefined;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logEvent(createLogEvent("router_decision", "info"));

    expect(info).toHaveBeenCalledTimes(1);
  });

  it("stays silent in production by default", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_DEBUG_LOGS = undefined;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logEvent(createLogEvent("router_decision", "info"));

    expect(info).not.toHaveBeenCalled();
  });

  it("can be forced on in production via NEXT_PUBLIC_DEBUG_LOGS", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_DEBUG_LOGS = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logEvent(createLogEvent("router_decision", "info"));

    expect(info).toHaveBeenCalledTimes(1);
  });

  it("maps critical events onto console.error", () => {
    process.env.NODE_ENV = "development";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logEvent(createLogEvent("router_decision", "critical"));

    expect(error).toHaveBeenCalledTimes(1);
  });

  it("does not print raw runtime content even when debug logging is enabled", () => {
    process.env.NODE_ENV = "development";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logEvent(createLogEvent("inference.completed", "info", { userText: "private user text" }));

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(info.mock.calls)).not.toContain("private user text");
    expect(JSON.stringify(info.mock.calls)).toContain("[FORBIDDEN_FIELD_REMOVED]");
  });

  it("redacts manually constructed log event data before console output", () => {
    process.env.NODE_ENV = "development";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logEvent({
      event: "inference.completed",
      level: "info",
      timestamp: new Date().toISOString(),
      data: { outputText: "private generated response" },
      contentLogged: false,
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(info.mock.calls)).not.toContain("private generated response");
    expect(JSON.stringify(info.mock.calls)).toContain("[FORBIDDEN_FIELD_REMOVED]");
  });
});

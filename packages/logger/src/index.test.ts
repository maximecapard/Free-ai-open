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
});

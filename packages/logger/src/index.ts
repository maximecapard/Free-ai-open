import { redactTelemetryPayload } from "@free-ai-open/privacy-redactor";

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

export interface LogEvent {
  event: string;
  level: LogLevel;
  timestamp: string;
  data?: Record<string, unknown>;
  contentLogged: false;
}

export function createLogEvent(event: string, level: LogLevel, data?: Record<string, unknown>): LogEvent {
  return {
    event,
    level,
    timestamp: new Date().toISOString(),
    data: data ? (redactTelemetryPayload(data) as Record<string, unknown>) : undefined,
    contentLogged: false,
  };
}

const CONSOLE_METHOD_BY_LEVEL: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  critical: "error",
};

// Console output is a local development aid only. It must never receive
// prompt, response, document, conversation, or other user content — callers
// are responsible for passing technical data (see LogEvent.data).
function isConsoleLoggingEnabled(): boolean {
  const env = typeof process !== "undefined" ? process.env : undefined;
  if (env?.NEXT_PUBLIC_DEBUG_LOGS === "true") return true;
  return env?.NODE_ENV !== "production";
}

export function logEvent(event: LogEvent): void {
  if (!isConsoleLoggingEnabled()) return;
  const method = CONSOLE_METHOD_BY_LEVEL[event.level];
  const safeEvent: LogEvent = event.data
    ? { ...event, data: redactTelemetryPayload(event.data) as Record<string, unknown> }
    : event;

  console[method](`[${safeEvent.event}]`, safeEvent);
}

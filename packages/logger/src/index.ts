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
    data,
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

export function logEvent(event: LogEvent): void {
  const method = CONSOLE_METHOD_BY_LEVEL[event.level];
  console[method](`[${event.event}]`, event);
}

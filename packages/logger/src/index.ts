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

import type { DiagnosticError } from "@free-ai-open/diagnostic-report";
import type { LocalLogRecord, RuntimeStatus } from "@free-ai-open/local-logs";

export interface LastRuntimeStatus {
  status: RuntimeStatus;
  timestamp: string;
}

export interface GenerationMetrics {
  firstTokenMs?: number | null;
  tokensPerSecond?: number;
  generationDurationMs?: number;
}

// `logs` is assumed sorted most-recent-first, as returned by getRecentLocalLogs.

export function findLoadedModelId(logs: readonly LocalLogRecord[]): string | null {
  return logs.find((log) => log.event === "model.load.completed")?.modelId ?? null;
}

export function findLastRuntimeStatus(logs: readonly LocalLogRecord[]): LastRuntimeStatus | null {
  const log = logs.find((entry) => entry.runtimeStatus !== undefined);
  return log?.runtimeStatus ? { status: log.runtimeStatus, timestamp: log.timestamp } : null;
}

export function findLoadTimeMs(logs: readonly LocalLogRecord[]): number | undefined {
  return logs.find((log) => log.performanceMetrics?.loadTimeMs !== undefined)?.performanceMetrics?.loadTimeMs;
}

export function findGenerationMetrics(logs: readonly LocalLogRecord[]): GenerationMetrics | null {
  const log = logs.find(
    (entry) =>
      entry.performanceMetrics?.tokensPerSecond !== undefined ||
      entry.performanceMetrics?.firstTokenMs !== undefined ||
      entry.performanceMetrics?.totalTimeMs !== undefined
  );
  if (!log?.performanceMetrics) return null;
  return {
    firstTokenMs: log.performanceMetrics.firstTokenMs,
    tokensPerSecond: log.performanceMetrics.tokensPerSecond,
    generationDurationMs: log.performanceMetrics.totalTimeMs,
  };
}

export function toRecentErrors(logs: readonly LocalLogRecord[]): DiagnosticError[] {
  return logs
    .filter(
      (log): log is LocalLogRecord & { severity: "warn" | "error" | "critical" } =>
        log.severity === "warn" || log.severity === "error" || log.severity === "critical"
    )
    .map((log) => ({
      event: log.event,
      severity: log.severity,
      timestamp: log.timestamp,
      modelId: log.modelId,
      backend: log.backend,
      errorCode: log.errorCode,
    }));
}

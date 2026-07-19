import type { DeviceProfile } from "@free-ai-open/device-profiler";
import type { DiagnosticMetrics, DiagnosticReportInput } from "@free-ai-open/diagnostic-report";
import type { LocalLogRecord } from "@free-ai-open/local-logs";
import type { ModelRouterResult } from "@free-ai-open/model-router";
import type { LocalBenchmarkResult, PerformanceMode, TaskCategory } from "@free-ai-open/types";
import {
  findGenerationMetrics,
  findLastRuntimeStatus,
  findLoadTimeMs,
  findLoadedModelId,
  toRecentErrors,
} from "./debugDiagnostics";

export const DEBUG_PREVIEW_TASK: TaskCategory = "chat";

export interface BuildDebugDiagnosticReportInputOptions {
  appVersion?: string;
  deviceProfile: DeviceProfile | null;
  routeResult: ModelRouterResult | null;
  mode?: PerformanceMode | null;
  runtimeStatus?: DiagnosticReportInput["runtimeStatus"];
  task?: TaskCategory;
  recommendedModelId?: string;
  loadedModelId?: string;
  logs: LocalLogRecord[];
  localBenchmark?: LocalBenchmarkResult | null;
}

function buildMetrics(logs: readonly LocalLogRecord[]): DiagnosticMetrics | undefined {
  const loadTimeMs = findLoadTimeMs(logs);
  const generationMetrics = findGenerationMetrics(logs);
  const metrics: DiagnosticMetrics = {};

  if (loadTimeMs !== undefined) metrics.modelLoadTimeMs = loadTimeMs;
  if (generationMetrics?.firstTokenMs !== undefined) metrics.firstTokenTimeMs = generationMetrics.firstTokenMs;
  if (generationMetrics?.tokensPerSecond !== undefined) metrics.tokensPerSecond = generationMetrics.tokensPerSecond;
  if (generationMetrics?.generationDurationMs !== undefined) {
    metrics.generationDurationMs = generationMetrics.generationDurationMs;
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

export function buildDebugDiagnosticReportInput({
  appVersion,
  deviceProfile,
  routeResult,
  mode,
  runtimeStatus,
  task,
  recommendedModelId,
  loadedModelId,
  logs,
  localBenchmark,
}: BuildDebugDiagnosticReportInputOptions): DiagnosticReportInput {
  return {
    appVersion,
    runtimeStatus: runtimeStatus ?? findLastRuntimeStatus(logs)?.status,
    deviceProfile: deviceProfile ?? undefined,
    performanceMode: mode ?? undefined,
    task: task ?? DEBUG_PREVIEW_TASK,
    recommendedModelId,
    routerResult: routeResult ? { selectedModel: routeResult.selectedModel, fallbackModel: routeResult.fallbackModel } : null,
    loadedModelId: loadedModelId ?? findLoadedModelId(logs) ?? undefined,
    recentErrors: toRecentErrors(logs),
    localLogs: logs,
    metrics: buildMetrics(logs),
    localBenchmark: localBenchmark ?? undefined,
  };
}

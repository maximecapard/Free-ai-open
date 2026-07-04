import { redactDiagnosticInput, validateDiagnosticReportPrivacy } from "./privacy";
import {
  asBackend,
  asBoolean,
  asDeviceTier,
  asErrorCode,
  asErrorSeverity,
  asEvent,
  asIsoTimestamp,
  asModelId,
  asNonNegativeNumber,
  asPerformanceMode,
  asRuntimeStatus,
  asSeverity,
  asShortTechnicalText,
  asTask,
  isRecord,
} from "./technical-validation";
import type {
  DiagnosticBrowserInfo,
  DiagnosticCacheState,
  DiagnosticError,
  DiagnosticLog,
  DiagnosticMetrics,
  DiagnosticReport,
  DiagnosticReportInput,
  DiagnosticReportOptions,
} from "./types";

const DEFAULT_MAX_ERRORS = 10;
const DEFAULT_MAX_LOGS = 25;

function hasKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function sanitizeMetrics(value: unknown): DiagnosticMetrics | undefined {
  if (!isRecord(value)) return undefined;

  const metrics: DiagnosticMetrics = {};
  const modelLoadTimeMs = asNonNegativeNumber(value.modelLoadTimeMs ?? value.loadTimeMs);
  if (modelLoadTimeMs !== undefined) metrics.modelLoadTimeMs = modelLoadTimeMs;

  const firstTokenTimeMs = value.firstTokenTimeMs ?? value.firstTokenMs;
  if (firstTokenTimeMs === null || asNonNegativeNumber(firstTokenTimeMs) !== undefined) {
    metrics.firstTokenTimeMs = firstTokenTimeMs as number | null;
  }

  const tokensPerSecond = asNonNegativeNumber(value.tokensPerSecond);
  if (tokensPerSecond !== undefined) metrics.tokensPerSecond = tokensPerSecond;

  const generationDurationMs = asNonNegativeNumber(value.generationDurationMs ?? value.totalTimeMs);
  if (generationDurationMs !== undefined) metrics.generationDurationMs = generationDurationMs;

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function sanitizeBrowserInfo(value: unknown): DiagnosticBrowserInfo | undefined {
  if (!isRecord(value)) return undefined;

  const browserInfo: DiagnosticBrowserInfo = {};
  const browserFamily = asShortTechnicalText(value.browserFamily, 80);
  if (browserFamily) browserInfo.browserFamily = browserFamily;
  const osFamily = asShortTechnicalText(value.osFamily, 80);
  if (osFamily) browserInfo.osFamily = osFamily;

  return Object.keys(browserInfo).length > 0 ? browserInfo : undefined;
}

function sanitizeCacheState(value: unknown): DiagnosticCacheState | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status === "available" || value.status === "unavailable" || value.status === "unknown" ? value.status : undefined;
  if (!status) return undefined;

  const cacheState: DiagnosticCacheState = { status };
  const estimatedUsageBytes = asNonNegativeNumber(value.estimatedUsageBytes);
  if (estimatedUsageBytes !== undefined) cacheState.estimatedUsageBytes = estimatedUsageBytes;
  const estimatedQuotaBytes = asNonNegativeNumber(value.estimatedQuotaBytes);
  if (estimatedQuotaBytes !== undefined) cacheState.estimatedQuotaBytes = estimatedQuotaBytes;
  return cacheState;
}

function sanitizeError(value: unknown): DiagnosticError | null {
  if (!isRecord(value)) return null;
  const severity = asErrorSeverity(value.severity);
  if (!severity) return null;

  const error: DiagnosticError = { severity };
  const event = asEvent(value.event);
  if (event) error.event = event;
  const timestamp = asIsoTimestamp(value.timestamp);
  if (timestamp) error.timestamp = timestamp;
  const modelId = asModelId(value.modelId);
  if (modelId) error.modelId = modelId;
  const backend = asBackend(value.backend);
  if (backend) error.backend = backend;
  const errorCode = asErrorCode(value.errorCode);
  if (errorCode) error.errorCode = errorCode;
  return error;
}

function sanitizeLog(value: unknown): DiagnosticLog | null {
  if (!isRecord(value)) return null;
  const event = asEvent(value.event);
  const severity = asSeverity(value.severity);
  const timestamp = asIsoTimestamp(value.timestamp);
  if (!event || !severity || !timestamp) return null;

  const log: DiagnosticLog = { event, severity, timestamp };
  const modelId = asModelId(value.modelId);
  if (modelId) log.modelId = modelId;
  const backend = asBackend(value.backend);
  if (backend) log.backend = backend;
  const runtimeStatus = asRuntimeStatus(value.runtimeStatus);
  if (runtimeStatus) log.runtimeStatus = runtimeStatus;
  const errorCode = asErrorCode(value.errorCode);
  if (errorCode) log.errorCode = errorCode;
  const deviceTier = asDeviceTier(value.deviceTier);
  if (deviceTier !== undefined) log.deviceTier = deviceTier;
  const performanceMetrics = sanitizeMetrics(value.performanceMetrics);
  if (performanceMetrics) log.performanceMetrics = performanceMetrics;
  return log;
}

function sanitizeArray<T>(value: unknown, mapper: (item: unknown) => T | null, limit: number): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(mapper).filter((item): item is T => item !== null).slice(0, limit);
}

export function buildDiagnosticReport(
  input: DiagnosticReportInput,
  options: DiagnosticReportOptions = {}
): DiagnosticReport {
  const maxErrors = options.maxErrors ?? DEFAULT_MAX_ERRORS;
  const maxLogs = options.maxLogs ?? DEFAULT_MAX_LOGS;
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const redacted = redactDiagnosticInput(input);
  const source = isRecord(redacted) ? redacted : {};
  const deviceProfile = isRecord(source.deviceProfile) ? source.deviceProfile : undefined;
  const routerResult = isRecord(source.routerResult) ? source.routerResult : undefined;
  const selectedModel = routerResult && isRecord(routerResult.selectedModel) ? routerResult.selectedModel : undefined;
  const fallbackModel = routerResult && isRecord(routerResult.fallbackModel) ? routerResult.fallbackModel : undefined;
  const recommendedModel = isRecord(source.recommendedModel) ? source.recommendedModel : undefined;

  const report: DiagnosticReport = {
    generatedAt,
    contentLogged: false,
    recentErrors: sanitizeArray(source.recentErrors, sanitizeError, maxErrors),
    localLogs: sanitizeArray(source.localLogs, sanitizeLog, maxLogs),
  };

  const appVersion = asShortTechnicalText(source.appVersion, 40);
  if (appVersion) report.appVersion = appVersion;

  const runtimeStatus = asRuntimeStatus(source.runtimeStatus);
  if (runtimeStatus) report.runtimeStatus = runtimeStatus;

  const backend = asBackend(source.backend) ?? asBackend(deviceProfile?.preferredBackend);
  if (backend) report.backend = backend;

  const webgpuAvailable = asBoolean(source.webgpuAvailable) ?? asBoolean(deviceProfile?.webgpuAvailable);
  if (webgpuAvailable !== undefined) report.webgpuAvailable = webgpuAvailable;

  const deviceTier = asDeviceTier(source.deviceTier) ?? asDeviceTier(deviceProfile?.deviceTier);
  if (deviceTier !== undefined) report.deviceTier = deviceTier;

  const performanceMode = asPerformanceMode(source.performanceMode);
  if (performanceMode) report.performanceMode = performanceMode;

  const task = asTask(source.task);
  if (task) report.task = task;

  const recommendedModelId =
    asModelId(source.recommendedModelId) ?? asModelId(recommendedModel?.id) ?? asModelId(selectedModel?.id) ?? asModelId(fallbackModel?.id);
  if (recommendedModelId) report.recommendedModelId = recommendedModelId;

  const loadedModelId = asModelId(source.loadedModelId);
  if (loadedModelId) report.loadedModelId = loadedModelId;

  const cacheState = sanitizeCacheState(source.cacheState);
  if (cacheState) report.cacheState = cacheState;

  const metrics = sanitizeMetrics(source.metrics);
  if (metrics) report.metrics = metrics;

  const browserInfo = sanitizeBrowserInfo(source.browserInfo) ?? sanitizeBrowserInfo(deviceProfile);
  if (browserInfo) report.browserInfo = browserInfo;

  if (hasKey(source, "contentLogged")) {
    report.contentLogged = false;
  }

  const privacy = validateDiagnosticReportPrivacy(report);
  if (!privacy.valid) {
    return {
      generatedAt,
      contentLogged: false,
      recentErrors: [],
      localLogs: [],
    };
  }

  return report;
}

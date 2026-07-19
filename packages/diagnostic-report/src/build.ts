import { redactDiagnosticInput, validateDiagnosticReportPrivacy } from "./privacy";
import {
  asBackend,
  asBoolean,
  asArchitectureClass,
  asBrowserFamily,
  asCapabilityClass,
  asCapabilityConfidence,
  asCoarseClass,
  asDeviceTier,
  asErrorCode,
  asErrorSeverity,
  asEvent,
  asExperimentalMemoryClass,
  asFormFactor,
  asGpuArchitectureClass,
  asGpuDescriptionClass,
  asGpuFeatureClass,
  asGpuLimitKey,
  asGpuVendorClass,
  asIsoTimestamp,
  asModelId,
  asNonNegativeNumber,
  asOsFamily,
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
  DiagnosticCapabilityProfile,
  DiagnosticError,
  DiagnosticLog,
  DiagnosticLocalBenchmark,
  DiagnosticMetrics,
  DiagnosticReport,
  DiagnosticReportInput,
  DiagnosticReportOptions,
} from "./types";

const DEFAULT_MAX_ERRORS = 10;
const DEFAULT_MAX_LOGS = 25;

function sanitizeLocalBenchmark(value: unknown): DiagnosticLocalBenchmark | undefined {
  if (!isRecord(value)) return undefined;
  const benchmarkVersion = asShortTechnicalText(value.benchmarkVersion, 40);
  const measuredAt = asIsoTimestamp(value.measuredAt);
  const expiresAt = asIsoTimestamp(value.expiresAt);
  const status = value.status === "completed" || value.status === "cancelled" || value.status === "failed" || value.status === "unsupported"
    ? value.status
    : undefined;
  const stability = value.stability === "unknown" || value.stability === "stable" || value.stability === "degraded" || value.stability === "failed"
    ? value.stability
    : undefined;
  const confidence = asCapabilityConfidence(value.confidence);
  if (!benchmarkVersion || !measuredAt || !expiresAt || !status || !stability || !confidence) return undefined;

  const result: DiagnosticLocalBenchmark = { benchmarkVersion, measuredAt, expiresAt, status, stability, confidence };
  for (const key of ["webgpuInitMs", "computeScore", "medianComputeMs", "sampleCount", "mainThreadDelayMs", "durationMs"] as const) {
    const numeric = asNonNegativeNumber(value[key]);
    if (numeric !== undefined) result[key] = numeric;
  }
  if (value.timingMethod === "wall-clock" || value.timingMethod === "gpu-timestamp") result.timingMethod = value.timingMethod;
  const errorCode = asErrorCode(value.errorCode);
  if (errorCode) result.errorCode = errorCode as DiagnosticLocalBenchmark["errorCode"];
  return result;
}

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
  const browserFamily = asBrowserFamily(value.browserFamily);
  if (browserFamily) browserInfo.browserFamily = browserFamily;
  const osFamily = asOsFamily(value.osFamily);
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

function sanitizeCapabilityProfile(value: unknown): DiagnosticCapabilityProfile | undefined {
  if (!isRecord(value)) return undefined;

  const profile: DiagnosticCapabilityProfile = {};
  const schemaVersion = asNonNegativeNumber(value.schemaVersion);
  if (schemaVersion !== undefined) profile.schemaVersion = schemaVersion;
  const detectedAt = asIsoTimestamp(value.detectedAt);
  if (detectedAt) profile.detectedAt = detectedAt;
  const expiresAt = asIsoTimestamp(value.expiresAt);
  if (expiresAt) profile.expiresAt = expiresAt;
  const formFactor = asFormFactor(value.formFactor);
  if (formFactor) profile.formFactor = formFactor;
  const architectureClass = asArchitectureClass(value.architectureClass);
  if (architectureClass) profile.architectureClass = architectureClass;
  const browserFamily = asBrowserFamily(value.browserFamily);
  if (browserFamily) profile.browserFamily = browserFamily;
  const osFamily = asOsFamily(value.osFamily);
  if (osFamily) profile.osFamily = osFamily;
  const memoryClass = asCoarseClass(value.memoryClass);
  if (memoryClass) profile.memoryClass = memoryClass;
  const logicalProcessorClass = asCoarseClass(value.logicalProcessorClass);
  if (logicalProcessorClass) profile.logicalProcessorClass = logicalProcessorClass;
  const webgpuAvailable = asBoolean(value.webgpuAvailable);
  if (webgpuAvailable !== undefined) profile.webgpuAvailable = webgpuAvailable;
  const wasmAvailable = asBoolean(value.wasmAvailable);
  if (wasmAvailable !== undefined) profile.wasmAvailable = wasmAvailable;
  const fallbackAdapter = asBoolean(value.fallbackAdapter);
  if (fallbackAdapter !== undefined) profile.fallbackAdapter = fallbackAdapter;
  const capabilityClass = asCapabilityClass(value.capabilityClass);
  if (capabilityClass) profile.capabilityClass = capabilityClass;
  const deviceTier = asDeviceTier(value.deviceTier);
  if (deviceTier !== undefined) profile.deviceTier = deviceTier;
  const confidence = asCapabilityConfidence(value.confidence);
  if (confidence) profile.confidence = confidence;

  if (isRecord(value.gpu)) {
    const featureClasses = Array.isArray(value.gpu.featureClasses)
      ? value.gpu.featureClasses
          .map(asGpuFeatureClass)
          .filter((item): item is string => item !== undefined)
          .sort()
      : [];
    const limitClasses: Record<string, string> = {};
    if (isRecord(value.gpu.limitClasses)) {
      for (const [key, limitClass] of Object.entries(value.gpu.limitClasses)) {
        const safeKey = asGpuLimitKey(key);
        const safeValue = asCoarseClass(limitClass);
        if (safeKey && safeValue) limitClasses[safeKey] = safeValue;
      }
    }

    profile.gpu = {
      ...(asGpuVendorClass(value.gpu.vendorClass) ? { vendorClass: asGpuVendorClass(value.gpu.vendorClass) } : {}),
      ...(asGpuArchitectureClass(value.gpu.architectureClass)
        ? { architectureClass: asGpuArchitectureClass(value.gpu.architectureClass) }
        : {}),
      ...(asGpuDescriptionClass(value.gpu.descriptionClass)
        ? { descriptionClass: asGpuDescriptionClass(value.gpu.descriptionClass) }
        : {}),
      featureClasses,
      limitClasses,
      ...(asExperimentalMemoryClass(value.gpu.experimentalMemoryClass)
        ? { experimentalMemoryClass: asExperimentalMemoryClass(value.gpu.experimentalMemoryClass) }
        : {}),
      ...(value.gpu.experimentalMemoryConfidence === "low" ? { experimentalMemoryConfidence: "low" as const } : {}),
    };
  }

  return Object.keys(profile).length > 0 ? profile : undefined;
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
  const capabilityProfileSource =
    isRecord(source.capabilityProfile)
      ? source.capabilityProfile
      : isRecord(deviceProfile?.staticCapabilityProfile)
        ? deviceProfile.staticCapabilityProfile
        : undefined;
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

  const capabilityProfile = sanitizeCapabilityProfile(capabilityProfileSource);
  if (capabilityProfile) report.capabilityProfile = capabilityProfile;

  const localBenchmark = sanitizeLocalBenchmark(source.localBenchmark);
  if (localBenchmark) report.localBenchmark = localBenchmark;

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

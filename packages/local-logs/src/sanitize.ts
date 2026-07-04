import { redactTelemetryPayload } from "@free-ai-open/privacy-redactor";
import type {
  LocalLogInput,
  LocalLogPerformanceMetrics,
  LocalLogRecord,
  LocalLogSeverity,
  RuntimeStatus,
} from "./types";

const EVENT_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+){1,4}$/;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const UPPERCASE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const TECHNICAL_ERROR_SLUG_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

const SEVERITIES = new Set<LocalLogSeverity>(["debug", "info", "warn", "error", "critical"]);
const BACKENDS = new Set(["webgpu", "wasm", "cpu"]);
const RUNTIME_STATUSES = new Set<RuntimeStatus>(["idle", "loading_model", "ready", "generating", "cancelling", "error"]);
const DEVICE_TIERS = new Set([0, 1, 2, 3, 4]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isTechnicalErrorCode(value: string): boolean {
  return UPPERCASE_ERROR_CODE_PATTERN.test(value) || TECHNICAL_ERROR_SLUG_PATTERN.test(value);
}

function sanitizePerformanceMetrics(value: unknown): LocalLogPerformanceMetrics | undefined {
  if (!isRecord(value)) return undefined;

  const metrics: LocalLogPerformanceMetrics = {};
  if (isNonNegativeNumber(value.loadTimeMs)) metrics.loadTimeMs = value.loadTimeMs;
  if (value.firstTokenMs === null || isNonNegativeNumber(value.firstTokenMs)) {
    metrics.firstTokenMs = value.firstTokenMs;
  }
  if (isNonNegativeNumber(value.tokensPerSecond)) metrics.tokensPerSecond = value.tokensPerSecond;
  if (isNonNegativeNumber(value.totalTimeMs)) metrics.totalTimeMs = value.totalTimeMs;

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

export function sanitizeLocalLogInput(
  input: LocalLogInput,
  id: string,
  fallbackTimestamp: string
): LocalLogRecord | null {
  const redacted = redactTelemetryPayload(input);
  if (!isRecord(redacted)) return null;

  if (typeof redacted.event !== "string" || !EVENT_PATTERN.test(redacted.event)) return null;
  if (typeof redacted.severity !== "string" || !SEVERITIES.has(redacted.severity as LocalLogSeverity)) return null;

  const timestamp = typeof redacted.timestamp === "string" ? redacted.timestamp : fallbackTimestamp;
  if (!ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return null;

  const record: LocalLogRecord = {
    id,
    event: redacted.event,
    severity: redacted.severity as LocalLogSeverity,
    timestamp,
  };

  if (typeof redacted.modelId === "string" && MODEL_ID_PATTERN.test(redacted.modelId)) {
    record.modelId = redacted.modelId;
  } else if (redacted.modelId !== undefined) {
    return null;
  }

  if (typeof redacted.backend === "string" && BACKENDS.has(redacted.backend)) {
    record.backend = redacted.backend as LocalLogRecord["backend"];
  } else if (redacted.backend !== undefined) {
    return null;
  }

  if (typeof redacted.runtimeStatus === "string" && RUNTIME_STATUSES.has(redacted.runtimeStatus as RuntimeStatus)) {
    record.runtimeStatus = redacted.runtimeStatus as RuntimeStatus;
  } else if (redacted.runtimeStatus !== undefined) {
    return null;
  }

  if (typeof redacted.errorCode === "string" && isTechnicalErrorCode(redacted.errorCode)) {
    record.errorCode = redacted.errorCode;
  } else if (redacted.errorCode !== undefined) {
    return null;
  }

  if (typeof redacted.deviceTier === "number" && DEVICE_TIERS.has(redacted.deviceTier)) {
    record.deviceTier = redacted.deviceTier as LocalLogRecord["deviceTier"];
  } else if (redacted.deviceTier !== undefined) {
    return null;
  }

  const performanceMetrics = sanitizePerformanceMetrics(redacted.performanceMetrics);
  if (performanceMetrics) record.performanceMetrics = performanceMetrics;

  return record;
}

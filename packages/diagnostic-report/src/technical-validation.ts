import { taskCategories, type Backend, type DeviceTier, type PerformanceMode, type TaskCategory } from "@free-ai-open/types";
import type { RuntimeStatus } from "@free-ai-open/local-logs";
import type { DiagnosticSeverity } from "./types";

const EVENT_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+){1,4}$/;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,159}$/;
const UPPERCASE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const TECHNICAL_ERROR_SLUG_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

const BACKENDS = new Set<Backend>(["webgpu", "wasm", "cpu"]);
const DEVICE_TIERS = new Set<DeviceTier>([0, 1, 2, 3, 4]);
const PERFORMANCE_MODES = new Set<PerformanceMode>(["fast", "balanced", "performance"]);
const TASKS = new Set<TaskCategory>(taskCategories);
const SEVERITIES = new Set<DiagnosticSeverity>(["debug", "info", "warn", "error", "critical"]);
const ERROR_SEVERITIES = new Set<DiagnosticSeverity>(["warn", "error", "critical"]);
// Single source of truth for this package: keeps the two runtimeStatus call
// sites in build.ts from drifting out of sync with @free-ai-open/local-logs'
// RuntimeStatus union the way they previously did when "cancelling" was added.
const RUNTIME_STATUSES = new Set<RuntimeStatus>([
  "idle",
  "loading_model",
  "ready",
  "generating",
  "cancelling",
  "recovering",
  "error",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asEvent(value: unknown): string | undefined {
  return typeof value === "string" && EVENT_PATTERN.test(value) ? value : undefined;
}

export function asModelId(value: unknown): string | undefined {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value) ? value : undefined;
}

export function asErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return UPPERCASE_ERROR_CODE_PATTERN.test(value) || TECHNICAL_ERROR_SLUG_PATTERN.test(value) ? value : undefined;
}

export function asIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

export function asBackend(value: unknown): Backend | undefined {
  return typeof value === "string" && BACKENDS.has(value as Backend) ? (value as Backend) : undefined;
}

export function asDeviceTier(value: unknown): DeviceTier | undefined {
  return typeof value === "number" && DEVICE_TIERS.has(value as DeviceTier) ? (value as DeviceTier) : undefined;
}

export function asPerformanceMode(value: unknown): PerformanceMode | undefined {
  return typeof value === "string" && PERFORMANCE_MODES.has(value as PerformanceMode)
    ? (value as PerformanceMode)
    : undefined;
}

export function asTask(value: unknown): TaskCategory | undefined {
  return typeof value === "string" && TASKS.has(value as TaskCategory) ? (value as TaskCategory) : undefined;
}

export function asSeverity(value: unknown): DiagnosticSeverity | undefined {
  return typeof value === "string" && SEVERITIES.has(value as DiagnosticSeverity) ? (value as DiagnosticSeverity) : undefined;
}

export function asErrorSeverity(value: unknown): Exclude<DiagnosticSeverity, "debug" | "info"> | undefined {
  return typeof value === "string" && ERROR_SEVERITIES.has(value as DiagnosticSeverity)
    ? (value as Exclude<DiagnosticSeverity, "debug" | "info">)
    : undefined;
}

export function asRuntimeStatus(value: unknown): RuntimeStatus | undefined {
  return typeof value === "string" && RUNTIME_STATUSES.has(value as RuntimeStatus) ? (value as RuntimeStatus) : undefined;
}

export function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asShortTechnicalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined;
  return /^[A-Za-z0-9._ -]+$/.test(trimmed) ? trimmed : undefined;
}

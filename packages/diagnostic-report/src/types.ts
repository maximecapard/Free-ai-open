import type { DeviceProfile } from "@free-ai-open/device-profiler";
import type { LocalLogRecord, RuntimeStatus } from "@free-ai-open/local-logs";
import type { ModelRecord } from "@free-ai-open/model-registry";
import type { ModelRouterResult } from "@free-ai-open/model-router";
import type {
  Backend,
  CapabilityClass,
  CapabilityConfidence,
  DeviceTier,
  FormFactor,
  LocalBenchmarkResult,
  PerformanceMode,
  TaskCategory,
} from "@free-ai-open/types";
import type { StaticCapabilityProfile } from "@free-ai-open/types";

export type DiagnosticSeverity = "debug" | "info" | "warn" | "error" | "critical";

export type CacheStatus = "available" | "unavailable" | "unknown";

export interface DiagnosticCacheState {
  status: CacheStatus;
  estimatedUsageBytes?: number;
  estimatedQuotaBytes?: number;
}

export interface DiagnosticMetrics {
  modelLoadTimeMs?: number;
  firstTokenTimeMs?: number | null;
  tokensPerSecond?: number;
  generationDurationMs?: number;
}

export interface DiagnosticLocalBenchmark {
  benchmarkVersion: string;
  measuredAt: string;
  expiresAt: string;
  status: LocalBenchmarkResult["status"];
  webgpuInitMs?: number;
  computeScore?: number;
  medianComputeMs?: number;
  sampleCount?: number;
  mainThreadDelayMs?: number;
  durationMs?: number;
  timingMethod?: LocalBenchmarkResult["timingMethod"];
  stability: LocalBenchmarkResult["stability"];
  confidence: LocalBenchmarkResult["confidence"];
  errorCode?: LocalBenchmarkResult["errorCode"];
}

export interface DiagnosticBrowserInfo {
  browserFamily?: string;
  osFamily?: string;
}

export interface DiagnosticCapabilityProfile {
  schemaVersion?: number;
  detectedAt?: string;
  expiresAt?: string;
  formFactor?: FormFactor;
  architectureClass?: string;
  browserFamily?: string;
  osFamily?: string;
  memoryClass?: string;
  logicalProcessorClass?: string;
  webgpuAvailable?: boolean;
  wasmAvailable?: boolean;
  fallbackAdapter?: boolean;
  capabilityClass?: CapabilityClass;
  deviceTier?: DeviceTier;
  confidence?: CapabilityConfidence;
  gpu?: {
    vendorClass?: string;
    architectureClass?: string;
    descriptionClass?: string;
    featureClasses: string[];
    limitClasses: Record<string, string>;
    experimentalMemoryClass?: string;
    experimentalMemoryConfidence?: "low";
  };
}

export interface DiagnosticError {
  event?: string;
  severity: Exclude<DiagnosticSeverity, "debug" | "info">;
  timestamp?: string;
  modelId?: string;
  backend?: Backend;
  errorCode?: string;
}

export interface DiagnosticLog {
  event: string;
  severity: DiagnosticSeverity;
  timestamp: string;
  modelId?: string;
  backend?: Backend;
  runtimeStatus?: RuntimeStatus;
  errorCode?: string;
  deviceTier?: DeviceTier;
  performanceMetrics?: DiagnosticMetrics;
}

export interface DiagnosticReportInput {
  appVersion?: string;
  runtimeStatus?: RuntimeStatus;
  backend?: Backend;
  webgpuAvailable?: boolean;
  deviceTier?: DeviceTier;
  performanceMode?: PerformanceMode;
  task?: TaskCategory;
  recommendedModelId?: string;
  recommendedModel?: Pick<ModelRecord, "id"> | null;
  loadedModelId?: string;
  cacheState?: DiagnosticCacheState;
  recentErrors?: DiagnosticError[];
  localLogs?: LocalLogRecord[];
  metrics?: DiagnosticMetrics;
  browserInfo?: DiagnosticBrowserInfo;
  deviceProfile?: DeviceProfile;
  capabilityProfile?: StaticCapabilityProfile;
  localBenchmark?: LocalBenchmarkResult;
  routerResult?: Pick<ModelRouterResult, "selectedModel" | "fallbackModel"> | null;
}

export interface DiagnosticReport {
  generatedAt: string;
  contentLogged: false;
  appVersion?: string;
  runtimeStatus?: RuntimeStatus;
  backend?: Backend;
  webgpuAvailable?: boolean;
  deviceTier?: DeviceTier;
  performanceMode?: PerformanceMode;
  task?: TaskCategory;
  recommendedModelId?: string;
  loadedModelId?: string;
  cacheState?: DiagnosticCacheState;
  recentErrors: DiagnosticError[];
  localLogs: DiagnosticLog[];
  metrics?: DiagnosticMetrics;
  browserInfo?: DiagnosticBrowserInfo;
  capabilityProfile?: DiagnosticCapabilityProfile;
  localBenchmark?: DiagnosticLocalBenchmark;
}

export interface DiagnosticReportOptions {
  now?: () => Date;
  maxErrors?: number;
  maxLogs?: number;
}

export interface DiagnosticReportPrivacyResult {
  valid: boolean;
  violations: string[];
}

export interface ClipboardDiagnosticReportData {
  "application/json": string;
  "text/plain": string;
}

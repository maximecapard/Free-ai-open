import type { Backend, DeviceTier } from "@free-ai-open/types";

export type LocalLogSeverity = "debug" | "info" | "warn" | "error" | "critical";

export type RuntimeStatus = "idle" | "loading_model" | "ready" | "generating" | "error";

export interface LocalLogPerformanceMetrics {
  loadTimeMs?: number;
  firstTokenMs?: number | null;
  tokensPerSecond?: number;
  totalTimeMs?: number;
}

export interface LocalLogInput {
  event: string;
  severity: LocalLogSeverity;
  timestamp?: string;
  modelId?: string;
  backend?: Backend;
  runtimeStatus?: RuntimeStatus;
  errorCode?: string;
  deviceTier?: DeviceTier;
  performanceMetrics?: LocalLogPerformanceMetrics;
}

export interface LocalLogRecord extends LocalLogInput {
  id: string;
  timestamp: string;
}

export interface LocalLogStore {
  add(record: LocalLogRecord): Promise<void>;
  getAll(): Promise<LocalLogRecord[]>;
  clear(): Promise<void>;
  delete(ids: string[]): Promise<void>;
}

export interface LocalLogsClientOptions {
  store?: LocalLogStore | null;
  maxLogs?: number;
  maxAgeMs?: number;
  now?: () => Date;
  idFactory?: () => string;
}

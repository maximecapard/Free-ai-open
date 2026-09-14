import type { Backend, DeviceTier } from "@free-ai-open/types";

export type LocalLogSeverity = "debug" | "info" | "warn" | "error" | "critical";

export type RuntimeStatus = "idle" | "loading_model" | "ready" | "generating" | "cancelling" | "recovering" | "error";

export interface LocalLogPerformanceMetrics {
  loadTimeMs?: number;
  firstTokenMs?: number | null;
  // A heuristic, chunk-count-derived rate -- never an authoritative
  // tokens/sec figure. Kept entirely separate from the exact* fields below.
  tokensPerSecond?: number;
  totalTimeMs?: number;
  // Whether the runtime reported a real, tokenizer-backed token count for
  // this generation (see @free-ai-open/ai-runtime's GenerationTokenUsage) --
  // present even when "unavailable", so a diagnostic reader can tell
  // "we checked and there was none" apart from "this log predates exact
  // usage capture entirely".
  tokenCountConfidence?: "exact" | "unavailable";
  // The exact* fields below all originate from one validated WebLLM usage
  // object (@free-ai-open/ai-runtime's GenerationTokenUsageExact) and are
  // only ever present together, only when tokenCountConfidence is "exact"
  // -- never estimated from characters, bytes, words, or chunk counts.
  exactGeneratedTokenCount?: number;
  exactPromptTokenCount?: number;
  // completion tokens divided by the FULL ai-runtime inference wall-clock
  // (includes prefill/TTFT) -- NOT decode-only throughput. See
  // @free-ai-open/ai-runtime's GenerationTokenUsageExact.overallCompletionTokensPerSecond
  // for the exact semantics this mirrors. There is deliberately no
  // prompt/prefill-throughput field here: neither WebLLM's own
  // `usage.extra.prefill_tokens_per_s` nor a time-to-first-token-derived
  // rate is exact enough to sit alongside these exact fields.
  exactOverallCompletionTokensPerSecond?: number;
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

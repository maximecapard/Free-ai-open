import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { LocalBenchmarkResult, ModelPerformanceObservation } from "@free-ai-open/types";
import type { RouterInput, RouterWarningCode } from "./adaptiveRouterContracts";

export interface ObservationSummary {
  count: number;
  effectiveCount: number;
  completed: number;
  successfulLoads: number;
  stalls: number;
  outOfMemory: number;
  deviceLosses: number;
  degenerate: number;
  loadFailures: number;
  averageLoadTimeMs?: number;
  averageTokensPerSecond?: number;
  averageFirstTokenMs?: number;
  maxTestedContextTokens?: number;
}

export interface NormalizedRouterInput extends Omit<RouterInput, "benchmark" | "observations" | "cachedModelIds"> {
  benchmark?: LocalBenchmarkResult;
  observations: ModelPerformanceObservation[];
  cachedModelIds: Set<string>;
  warnings: RouterWarningCode[];
}

export interface EligibleCandidate {
  model: ModelRegistryRecord;
  observations: ObservationSummary;
}

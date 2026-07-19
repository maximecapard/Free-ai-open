import type {
  CapabilityConfidence,
  LocalBenchmarkResult,
  ModelPerformanceObservation,
  PerformanceMode,
  StaticCapabilityProfile,
  TaskCategory,
} from "@free-ai-open/types";

// v0.7.0-alpha "Adaptive Model Router v1" contracts. They coexist
// with, and do not replace, the v0.6 `ModelRouterInput`/`ModelRouterResult`/
// `selectRecommendedModel()` in ./types and ./router, which remain the
// active routing path today.
//
// Conversation content is never part of router input: only the task label,
// locale, performance-mode preference, coarse capability/benchmark signals,
// technical observations, and model IDs.
export interface RouterInput {
  task: TaskCategory;
  locale: "en" | "fr";
  performanceMode: PerformanceMode;
  capability: StaticCapabilityProfile;
  benchmark?: LocalBenchmarkResult;
  observations: ModelPerformanceObservation[];
  cachedModelIds: string[];
  registryVersion: string;
  manualModelId?: string;
}

export type RouterReasonCode =
  | "manual_selection"
  | "task_match"
  | "language_match"
  | "measured_stable"
  | "measured_fast"
  | "mobile_optimized"
  | "cached_locally"
  | "resource_margin"
  | "performance_mode_match"
  | "compatibility_fallback";

export type RouterWarningCode =
  | "capability_schema_unsupported"
  | "capability_stale"
  | "benchmark_missing"
  | "benchmark_low_confidence"
  | "resource_unknown"
  | "previous_stall"
  | "previous_oom"
  | "previous_device_loss"
  | "download_large"
  | "performance_evidence_limited"
  | "manual_model_unknown"
  | "manual_model_ineligible"
  | "manual_choice_marginal"
  | "registry_version_mismatch"
  | "registry_invalid"
  | "no_eligible_model";

export type RouterRejectionCode =
  | "model_not_verified"
  | "backend_unavailable"
  | "fallback_adapter_unsupported"
  | "required_feature_missing"
  | "required_limit_missing"
  | "insufficient_memory"
  | "form_factor_unsupported"
  | "task_unsupported"
  | "metadata_incomplete"
  | "repeated_oom"
  | "repeated_stall"
  | "repeated_device_loss";

export interface RouterRejectedModel {
  modelId: string;
  reasons: RouterRejectionCode[];
}

export interface RouterScoreBreakdown {
  modelId: string;
  total: number;
  observed: number;
  capability: number;
  task: number;
  language: number;
  performanceMode: number;
  convenience: number;
}

export interface RouterDecision {
  selectedModelId: string | null;
  fallbackModelIds: string[];
  confidence: CapabilityConfidence;
  reasons: RouterReasonCode[];
  warnings: RouterWarningCode[];
  rejectedModels: RouterRejectedModel[];
  candidateScores: RouterScoreBreakdown[];
  recommendedContextTokens: number;
  recommendedMaxOutputTokens: number;
  registryVersion: string;
  decisionVersion: string;
}

import type {
  CapabilityConfidence,
  LocalBenchmarkResult,
  ModelPerformanceObservation,
  PerformanceMode,
  StaticCapabilityProfile,
  TaskCategory,
} from "@free-ai-open/types";

// v0.7.0-alpha "Adaptive Model Router v1" contracts (Phase 0: contracts and
// architecture only). These are additive, forward-declared types for the
// router entry point later phases will implement — see
// 06_ADAPTIVE_ROUTER_CORE_PROMPT_CODEX.md and docs/roadmap.md. They coexist
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
  manualModelId?: string;
}

export interface RouterDecision {
  selectedModelId: string;
  fallbackModelIds: string[];
  confidence: CapabilityConfidence;
  reasons: string[];
  warnings: string[];
  recommendedContextTokens: number;
  recommendedMaxOutputTokens: number;
  decisionVersion: string;
}

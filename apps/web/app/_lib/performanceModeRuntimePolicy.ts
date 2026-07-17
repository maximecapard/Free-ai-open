import type { RuntimeStatus } from "@free-ai-open/ai-runtime";
import type { PerformanceMode } from "@free-ai-open/types";

export type PerformanceModeChangeDecision =
  | { type: "noop" }
  | { type: "blocked_active_generation" }
  | { type: "persist_only" }
  | { type: "replace_runtime" };

export interface ResolvePerformanceModeChangeInput {
  currentMode: PerformanceMode | null;
  nextMode: PerformanceMode;
  runtimeStatus: RuntimeStatus;
  runtimeLoaded: boolean;
  replacementRequired: boolean;
}

export function isPerformanceModeChangeBlockedStatus(status: RuntimeStatus): boolean {
  return status === "generating" || status === "cancelling" || status === "recovering";
}

// v0.6.6-alpha still runs one placeholder WebLLM model regardless of the
// advisory router result. A performance-mode change therefore updates the
// persisted preference and future recommendations, but does not require a
// worker/model replacement until model selection is wired to the mode.
export function doesPerformanceModeRequireRuntimeReplacement(
  currentMode: PerformanceMode | null,
  nextMode: PerformanceMode
): boolean {
  void currentMode;
  void nextMode;
  return false;
}

export function resolvePerformanceModeChange({
  currentMode,
  nextMode,
  runtimeStatus,
  runtimeLoaded,
  replacementRequired,
}: ResolvePerformanceModeChangeInput): PerformanceModeChangeDecision {
  if (currentMode === nextMode) return { type: "noop" };
  if (isPerformanceModeChangeBlockedStatus(runtimeStatus)) return { type: "blocked_active_generation" };
  if (runtimeLoaded && replacementRequired) return { type: "replace_runtime" };
  return { type: "persist_only" };
}

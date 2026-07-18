import type { PerformanceMode, TaskCategory } from "@free-ai-open/types";

// v0.7.0-alpha Phase 4: decides whether the adaptive router needs to run
// again, rather than rerouting before every message. A RouterDecision is
// cheap and deterministic to recompute from already-persisted inputs (see
// docs/architecture.md), so this intentionally does not persist the decision
// itself to localStorage — only this cache KEY is kept in memory
// (AppRuntimeProvider) to detect when one of the "routing moments" listed in
// the mission prompt has actually occurred.
export interface RoutingCacheKeyInput {
  task: TaskCategory;
  locale: "en" | "fr";
  performanceMode: PerformanceMode;
  capabilityDetectedAt: string;
  benchmarkMeasuredAt?: string;
  manualModelId?: string;
  cachedModelIds: string[];
  registryVersion: string;
  currentModelRepeatedlyFailing: boolean;
}

export function buildRoutingCacheKey(input: RoutingCacheKeyInput): string {
  return JSON.stringify({
    task: input.task,
    locale: input.locale,
    performanceMode: input.performanceMode,
    capabilityDetectedAt: input.capabilityDetectedAt,
    benchmarkMeasuredAt: input.benchmarkMeasuredAt ?? null,
    manualModelId: input.manualModelId ?? null,
    // Sorted so the key only changes when *membership* of the cached-model
    // set changes, never because of incidental iteration order.
    cachedModelIds: [...input.cachedModelIds].sort(),
    registryVersion: input.registryVersion,
    currentModelRepeatedlyFailing: input.currentModelRepeatedlyFailing,
  });
}

export function shouldRecomputeRouterDecision(previousKey: string | null, nextKey: string): boolean {
  return previousKey !== nextKey;
}

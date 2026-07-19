import type { ModelPerformanceObservation, PerformanceMode, TaskCategory } from "@free-ai-open/types";

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
  observationsRevision: string;
}

export function buildObservationRevision(observations: readonly ModelPerformanceObservation[]): string {
  return JSON.stringify(
    observations.map((observation) => [
      observation.modelId,
      observation.observedAt,
      observation.outcome,
      observation.loadSucceeded,
      observation.loadTimeMs ?? null,
      observation.firstTokenTimeMs ?? null,
      observation.generationTokensPerSecond ?? null,
      observation.generationDurationMs ?? null,
    ])
  );
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
    observationsRevision: input.observationsRevision,
  });
}

export function shouldRecomputeRouterDecision(previousKey: string | null, nextKey: string): boolean {
  return previousKey !== nextKey;
}

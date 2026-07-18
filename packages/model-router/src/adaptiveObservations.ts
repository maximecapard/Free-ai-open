import type { ModelPerformanceObservation } from "@free-ai-open/types";
import type { ObservationSummary } from "./adaptiveInternal";

export const OBSERVATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_ROUTER_OBSERVATIONS = 200;

const OUTCOMES = new Set<ModelPerformanceObservation["outcome"]>([
  "completed", "cancelled", "stalled", "degenerate", "out_of_memory", "device_lost", "load_failed",
]);

export function normalizeObservations(
  observations: readonly ModelPerformanceObservation[],
  knownModelIds: ReadonlySet<string>,
  now: Date
): ModelPerformanceObservation[] {
  const oldest = now.getTime() - OBSERVATION_MAX_AGE_MS;
  return observations.filter((observation) => {
    const observedAt = Date.parse(observation.observedAt);
    return observation.schemaVersion === 1 &&
      knownModelIds.has(observation.modelId) &&
      typeof observation.loadSucceeded === "boolean" && OUTCOMES.has(observation.outcome) &&
      Number.isFinite(observedAt) && observedAt >= oldest && observedAt <= now.getTime();
  }).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt)).slice(-MAX_ROUTER_OBSERVATIONS);
}

function average(values: Array<number | undefined>): number | undefined {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return valid.length > 0 ? valid.reduce((sum, value) => sum + value, 0) / valid.length : undefined;
}

export function summarizeObservations(observations: readonly ModelPerformanceObservation[]): ObservationSummary {
  const effective = observations.filter((observation) => observation.outcome !== "cancelled");
  const count = (outcome: ModelPerformanceObservation["outcome"]) =>
    effective.filter((observation) => observation.outcome === outcome).length;
  return {
    count: observations.length,
    effectiveCount: effective.length,
    completed: count("completed"),
    successfulLoads: effective.filter((observation) => observation.loadSucceeded).length,
    stalls: count("stalled"),
    outOfMemory: count("out_of_memory"),
    deviceLosses: count("device_lost"),
    degenerate: count("degenerate"),
    loadFailures: count("load_failed"),
    averageLoadTimeMs: average(effective.map((observation) => observation.loadTimeMs)),
    averageTokensPerSecond: average(effective.map((observation) => observation.generationTokensPerSecond)),
    averageFirstTokenMs: average(effective.map((observation) => observation.firstTokenTimeMs)),
    maxTestedContextTokens: Math.max(0, ...effective.map((observation) => observation.testedContextTokens ?? 0)) || undefined,
  };
}

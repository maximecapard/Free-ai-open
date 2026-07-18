import type { ModelPerformanceObservation } from "@free-ai-open/types";

export interface ObservationsSummary {
  total: number;
  byOutcome: Record<ModelPerformanceObservation["outcome"], number>;
  byModel: Record<string, number>;
}

// Local-only technical summary for the /debug diagnostics surface (mission:
// "observations summary"). Never touches prompt/response content — the
// observations themselves are already technical-only, see
// performanceObservationBuilder.ts and docs/privacy.md.
export function summarizeStoredObservations(observations: readonly ModelPerformanceObservation[]): ObservationsSummary {
  const byOutcome: ObservationsSummary["byOutcome"] = {
    completed: 0,
    cancelled: 0,
    stalled: 0,
    degenerate: 0,
    out_of_memory: 0,
    device_lost: 0,
    load_failed: 0,
  };
  const byModel: Record<string, number> = {};

  for (const observation of observations) {
    byOutcome[observation.outcome] += 1;
    byModel[observation.modelId] = (byModel[observation.modelId] ?? 0) + 1;
  }

  return { total: observations.length, byOutcome, byModel };
}

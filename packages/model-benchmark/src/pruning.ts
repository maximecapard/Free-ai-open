import type { ModelBenchmarkResult } from "@free-ai-open/types";
import type { ModelBenchmarkHistoryLimits } from "./store";

// Pure function computing which ids to drop once a new result for
// `insertedModelId` has been written, given every record currently in the
// backend (including the newly-inserted one) and the caps to enforce.
// Shared by every storage backend's putAndPrune so the backends can never
// drift into enforcing different eviction semantics, and so the rule is
// unit-testable independent of IndexedDB/memory plumbing. Drops the oldest
// per-model excess first, then the oldest global excess among what
// remains -- so one frequently-re-benchmarked model can never crowd out
// every other model's history within the shared global cap.
export function computeModelBenchmarkIdsToPrune(
  allRecords: readonly ModelBenchmarkResult[],
  insertedModelId: string,
  limits: ModelBenchmarkHistoryLimits
): Set<string> {
  const idsToDelete = new Set<string>();

  const perModel = allRecords
    .filter((record) => record.modelId === insertedModelId)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  if (perModel.length > limits.maxPerModel) {
    for (const excess of perModel.slice(0, perModel.length - limits.maxPerModel)) {
      idsToDelete.add(excess.id);
    }
  }

  const remaining = allRecords
    .filter((record) => !idsToDelete.has(record.id))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  if (remaining.length > limits.maxTotal) {
    for (const excess of remaining.slice(0, remaining.length - limits.maxTotal)) {
      idsToDelete.add(excess.id);
    }
  }

  return idsToDelete;
}

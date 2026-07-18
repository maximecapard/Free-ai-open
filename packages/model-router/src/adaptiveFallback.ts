import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { EligibleCandidate } from "./adaptiveInternal";

function isNoHeavier(candidate: ModelRegistryRecord, selected: ModelRegistryRecord): boolean {
  const candidateBytes = candidate.runtimeMemory.value;
  const selectedBytes = selected.runtimeMemory.value;
  if (candidateBytes === undefined) return false;
  return selectedBytes === undefined || candidateBytes <= selectedBytes;
}

export function buildAdaptiveFallbackChain(
  selected: ModelRegistryRecord,
  eligibleCandidates: readonly EligibleCandidate[],
  registryRecords: readonly ModelRegistryRecord[],
  maxFallbacks = 3
): string[] {
  const eligible = new Map(eligibleCandidates.map((candidate) => [candidate.model.id, candidate.model]));
  const registry = new Map(registryRecords.map((model) => [model.id, model]));
  const queue = [...selected.fallbackModelIds];
  const visited = new Set([selected.id]);
  const result: string[] = [];
  let lastFallback = selected;

  while (queue.length > 0 && result.length < maxFallbacks) {
    const modelId = queue.shift();
    if (!modelId || visited.has(modelId)) continue;
    visited.add(modelId);
    const model = registry.get(modelId);
    if (!model) continue;
    queue.push(...model.fallbackModelIds);
    if (eligible.has(modelId) && isNoHeavier(model, lastFallback)) {
      result.push(modelId);
      lastFallback = model;
    }
  }
  return result;
}

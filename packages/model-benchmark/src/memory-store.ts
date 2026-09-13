import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { computeModelBenchmarkIdsToPrune } from "./pruning";
import type { ModelBenchmarkStore } from "./store";
import { sanitizeModelBenchmarkResult } from "./validation";

// INTERNAL implementation detail -- not exported from this package's public
// index (see index.ts's own comment). ModelBenchmarkStoreClient is the only
// sanctioned public entry point for persistence, but this adapter still
// enforces sanitization itself, on every write, as defense in depth: a raw
// adapter is intentionally still reachable from within this package (its
// own tests, and ModelBenchmarkStoreClient's composition) without ever
// relying on TypeScript structural typing alone to keep an unsanitized
// object -- one carrying, say, a stray `prompt`/`response` field a caller
// spread onto an otherwise-valid-looking object -- out of storage. See
// docs/security.md's "Local model benchmarking" section.
export function createMemoryModelBenchmarkStore(): ModelBenchmarkStore {
  const records = new Map<string, ModelBenchmarkResult>();

  return {
    async putAndPrune(result, limits) {
      const sanitized = sanitizeModelBenchmarkResult(result);
      if (!sanitized) throw new Error("Cannot persist an invalid ModelBenchmarkResult");
      // Persist the freshly-constructed sanitized object, never the
      // caller's own input reference -- sanitizeModelBenchmarkResult()
      // already rebuilds an allowlisted-fields-only object, so this never
      // carries an unknown/extra property the input might have had.
      records.set(sanitized.id, { ...sanitized });

      // Synchronous end-to-end (no `await` between the insert above and the
      // deletes below), so this is trivially atomic from any external
      // observer's point of view -- there is no interleaving point where
      // another call could see the insert without the resulting prune.
      const idsToDelete = computeModelBenchmarkIdsToPrune([...records.values()], sanitized.modelId, limits);
      for (const id of idsToDelete) {
        records.delete(id);
      }
    },
    async get(id) {
      const result = records.get(id);
      return result ? { ...result } : null;
    },
    async getAll() {
      return [...records.values()].map((result) => ({ ...result }));
    },
    async delete(id) {
      records.delete(id);
    },
    async clear() {
      records.clear();
    },
    async clearForModel(modelId) {
      for (const [id, result] of records) {
        if (result.modelId === modelId) records.delete(id);
      }
    },
  };
}

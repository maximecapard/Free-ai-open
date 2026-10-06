import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { computeModelBenchmarkIdsToPrune } from "./pruning";
import { markTrustedBackend } from "./trusted-store";
import type { TrustedModelBenchmarkStore } from "./trusted-store";
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
//
// TRUSTED backend (see trusted-store.ts): this implementation guarantees that an
// aborted write can never mutate afterwards. putAndPrune() performs both abort
// checks and then the insert-and-prune with no `await` in between, so there is
// no point at which an abort could interleave -- a write is either entirely
// refused before it mutates anything, or entirely applied before the call
// settles.
export function createMemoryModelBenchmarkStore(): TrustedModelBenchmarkStore {
  const records = new Map<string, ModelBenchmarkResult>();

  return markTrustedBackend({
    async putAndPrune(result, limits, options = {}) {
      if (options.signal?.aborted) {
        const error = new Error("Model benchmark persistence was aborted");
        error.name = "AbortError";
        throw error;
      }
      const sanitized = sanitizeModelBenchmarkResult(result);
      if (!sanitized) throw new Error("Cannot persist an invalid ModelBenchmarkResult");
      if (options.signal?.aborted) {
        const error = new Error("Model benchmark persistence was aborted");
        error.name = "AbortError";
        throw error;
      }
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
  });
}

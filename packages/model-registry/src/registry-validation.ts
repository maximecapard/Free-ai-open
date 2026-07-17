import { z } from "zod";
import { modelRegistryRecordSchema } from "./schema-v2";
import type { ModelRegistryRecord } from "./schema-v2";

function addFallbackGraphIssues(records: readonly ModelRegistryRecord[], context: z.RefinementCtx): void {
  const recordsById = new Map(records.map((record) => [record.id, record]));

  for (const [recordIndex, record] of records.entries()) {
    for (const fallbackId of record.fallbackModelIds) {
      if (!recordsById.has(fallbackId)) {
        context.addIssue({
          code: "custom",
          path: [recordIndex, "fallbackModelIds"],
          message: `Unknown fallback model ID: ${fallbackId}`,
        });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(modelId: string, path: string[]): void {
    if (visiting.has(modelId)) {
      context.addIssue({
        code: "custom",
        path: [records.findIndex((record) => record.id === modelId), "fallbackModelIds"],
        message: `Fallback cycle detected: ${[...path, modelId].join(" -> ")}`,
      });
      return;
    }
    if (visited.has(modelId)) return;

    const record = recordsById.get(modelId);
    if (!record) return;

    visiting.add(modelId);
    for (const fallbackId of record.fallbackModelIds) visit(fallbackId, [...path, modelId]);
    visiting.delete(modelId);
    visited.add(modelId);
  }

  for (const record of records) visit(record.id, []);
}

export const modelRegistryV2Schema = z
  .array(modelRegistryRecordSchema)
  .min(1)
  .max(12)
  .superRefine((records, context) => {
    const seenIds = new Set<string>();
    const seenWebLlmIds = new Set<string>();

    for (const [index, record] of records.entries()) {
      if (seenIds.has(record.id)) {
        context.addIssue({ code: "custom", path: [index, "id"], message: `Duplicate model ID: ${record.id}` });
      }
      seenIds.add(record.id);

      if (seenWebLlmIds.has(record.webllmModelId)) {
        context.addIssue({
          code: "custom",
          path: [index, "webllmModelId"],
          message: `Duplicate WebLLM model ID: ${record.webllmModelId}`,
        });
      }
      seenWebLlmIds.add(record.webllmModelId);
    }

    addFallbackGraphIssues(records, context);
  });

export function validateModelRegistryV2(input: unknown): ModelRegistryRecord[] {
  return modelRegistryV2Schema.parse(input);
}

export function isAutomaticRoutingEligible(record: ModelRegistryRecord): boolean {
  return record.status === "verified" && Boolean(record.verifiedAt && record.verifiedWithWebLLMVersion);
}

export function getAutomaticModelRegistry(records: readonly ModelRegistryRecord[]): ModelRegistryRecord[] {
  return records.filter(isAutomaticRoutingEligible);
}

export function hasAutomaticLanguageSupport(record: ModelRegistryRecord, locale: "en" | "fr"): boolean {
  return (
    isAutomaticRoutingEligible(record) &&
    (record.languages[locale] === "strong" || record.languages[locale] === "usable")
  );
}

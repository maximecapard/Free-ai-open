import { z } from "zod";
import type { Backend, DeviceTier, TaskCategory } from "@free-ai-open/types";

export const modelSources = ["huggingface", "r2", "local", "custom"] as const;
export const modelStatuses = ["stable", "experimental", "blocked"] as const;
export const modelBackends = ["webgpu", "wasm", "cpu"] as const satisfies readonly Backend[];
export const modelTasks = [
  "chat",
  "writing",
  "rewrite",
  "summarization",
  "translation",
  "coding",
  "learning",
  "document_analysis",
] as const satisfies readonly TaskCategory[];
export const deviceTiers = [0, 1, 2, 3, 4] as const satisfies readonly DeviceTier[];

const SECRET_PATTERN =
  /\b(?:sk-|pk_)[A-Za-z0-9_-]{12,}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)=/i;

function safeText(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !SECRET_PATTERN.test(value), "Model metadata must not contain secrets");
}

export const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Model IDs must be lowercase slugs");

export const modelUrlSchema = safeText(500).refine(
  (value) =>
    value.startsWith("hf://") ||
    value.startsWith("https://") ||
    value.startsWith("local://") ||
    value.startsWith("custom://"),
  "Model URLs must use hf://, https://, local://, or custom://"
);

export const sha256Schema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i, "sha256 must be a 64-character hex digest");

export const deviceTierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const modelRecordSchema = z
  .object({
    id: modelIdSchema,
    displayName: safeText(120),
    technicalName: safeText(180),
    source: z.enum(modelSources),
    modelUrl: modelUrlSchema,
    tasks: z.array(z.enum(modelTasks)).min(1),
    minDeviceTier: deviceTierSchema,
    recommendedDeviceTier: deviceTierSchema,
    estimatedDownloadGb: z.number().positive(),
    estimatedRamGb: z.number().positive(),
    backend: z.array(z.enum(modelBackends)).min(1),
    license: safeText(120),
    verified: z.boolean(),
    sha256: sha256Schema.optional(),
    status: z.enum(modelStatuses),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.recommendedDeviceTier < record.minDeviceTier) {
      context.addIssue({
        code: "custom",
        path: ["recommendedDeviceTier"],
        message: "recommendedDeviceTier must be greater than or equal to minDeviceTier",
      });
    }

    if (record.status === "stable" && !record.verified) {
      context.addIssue({
        code: "custom",
        path: ["verified"],
        message: "Stable models must be verified in the browser",
      });
    }
  });

export type ModelRecord = z.infer<typeof modelRecordSchema>;

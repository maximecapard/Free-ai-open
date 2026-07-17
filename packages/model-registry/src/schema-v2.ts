import { taskCategories } from "@free-ai-open/types";
import { z } from "zod";

export const MODEL_REGISTRY_SCHEMA_VERSION = 2 as const;

export const modelRegistryStatuses = ["verified", "experimental", "deprecated", "unavailable"] as const;
export const languageSupportLevels = ["strong", "usable", "limited", "unknown"] as const;
export const contextPresetIds = ["compatibility", "balanced", "performance"] as const;

const technicalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Technical IDs may contain letters, numbers, dots, underscores, and hyphens only");

export const modelRegistryIdSchema = technicalIdSchema
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Internal model IDs must be lowercase slugs");

const publicTextSchema = (maxLength: number) => z.string().trim().min(1).max(maxLength);
const httpsUrlSchema = z
  .string()
  .url()
  .max(600)
  .refine((value) => value.startsWith("https://"), "Registry source URLs must use HTTPS");

export const modelStatusSchema = z.enum(modelRegistryStatuses);
export const languageSupportSchema = z.enum(languageSupportLevels);
export const suitabilitySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const estimateSchema = z
  .object({
    value: z.number().int().positive().optional(),
    unit: z.enum(["bytes", "tokens"]),
    confidence: z.enum(["low", "medium", "high"]),
    source: httpsUrlSchema,
    testedContextTokens: z.number().int().positive().max(1_000_000).optional(),
    testedDeviceClass: z.enum(["mobile", "tablet", "desktop", "unknown"]).optional(),
  })
  .strict();

export const contextPresetSchema = z
  .object({
    id: z.enum(contextPresetIds),
    contextTokens: z.number().int().min(256).max(1_000_000),
    maxOutputTokens: z.number().int().min(1).max(100_000),
    estimatedExtraMemoryBytes: z.number().int().positive().optional(),
  })
  .strict()
  .refine((preset) => preset.maxOutputTokens < preset.contextTokens, {
    path: ["maxOutputTokens"],
    message: "Output tokens must leave room for input context",
  });

const taskSuitabilityShape = Object.fromEntries(taskCategories.map((task) => [task, suitabilitySchema])) as Record<
  (typeof taskCategories)[number],
  typeof suitabilitySchema
>;

export const taskSuitabilitySchema = z.object(taskSuitabilityShape).strict();

const languageSuitabilitySchema = z
  .object({
    en: languageSupportSchema,
    fr: languageSupportSchema,
    multilingual: languageSupportSchema,
  })
  .strict();

const formFactorSuitabilitySchema = z
  .object({
    mobile: suitabilitySchema,
    tablet: suitabilitySchema,
    desktop: suitabilitySchema,
  })
  .strict();

const performanceModeSuitabilitySchema = z
  .object({
    fast: suitabilitySchema,
    balanced: suitabilitySchema,
    performance: suitabilitySchema,
  })
  .strict();

const minimumCapabilitySchema = z
  .object({
    webgpuRequired: z.boolean(),
    wasmSupported: z.boolean(),
    fallbackAdapterAllowed: z.boolean(),
    approximateMemoryGB: z.number().positive().max(1024).optional(),
    requiredFeatures: z
      .array(publicTextSchema(80).regex(/^[a-z0-9][a-z0-9._-]*$/))
      .max(32)
      .refine((features) => new Set(features).size === features.length, "Required features must be unique")
      .optional(),
    minimumLimits: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), z.number().int().nonnegative()).optional(),
  })
  .strict();

const licenseSchema = z
  .object({
    id: publicTextSchema(80).regex(/^[a-z0-9][a-z0-9.-]*$/),
    name: publicTextSchema(160),
    sourceUrl: httpsUrlSchema,
    attributionRequired: z.boolean(),
  })
  .strict();

const modelSourceSchema = z
  .object({
    modelUrl: httpsUrlSchema,
    modelLibUrl: httpsUrlSchema,
    upstreamModelUrl: httpsUrlSchema,
    webllmConfigSource: httpsUrlSchema,
  })
  .strict();

export const modelRegistryRecordSchema = z
  .object({
    schemaVersion: z.literal(MODEL_REGISTRY_SCHEMA_VERSION),
    id: modelRegistryIdSchema,
    webllmModelId: technicalIdSchema,
    displayName: publicTextSchema(120),
    family: publicTextSchema(80),
    descriptionKey: publicTextSchema(160).regex(/^[a-z][A-Za-z0-9.]*$/),
    status: modelStatusSchema,
    verifiedAt: z.iso.datetime({ offset: true }).optional(),
    verifiedWithWebLLMVersion: publicTextSchema(40).regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/).optional(),
    quantization: publicTextSchema(40).regex(/^[A-Za-z0-9._-]+$/).optional(),
    parameterClass: publicTextSchema(40).regex(/^[A-Za-z0-9._-]+$/).optional(),
    downloadSize: estimateSchema,
    runtimeMemory: estimateSchema,
    contextPresets: z.array(contextPresetSchema).length(contextPresetIds.length),
    languages: languageSuitabilitySchema,
    tasks: taskSuitabilitySchema,
    formFactors: formFactorSuitabilitySchema,
    performanceModes: performanceModeSuitabilitySchema,
    minimumCapability: minimumCapabilitySchema,
    knownIssues: z.array(publicTextSchema(300)).max(16),
    license: licenseSchema,
    source: modelSourceSchema,
    fallbackModelIds: z.array(modelRegistryIdSchema).max(12),
  })
  .strict()
  .superRefine((record, context) => {
    const presetIds = record.contextPresets.map((preset) => preset.id);
    if (presetIds.some((id, index) => id !== contextPresetIds[index])) {
      context.addIssue({
        code: "custom",
        path: ["contextPresets"],
        message: "Context presets must be ordered compatibility, balanced, performance",
      });
    }

    for (let index = 1; index < record.contextPresets.length; index += 1) {
      const previous = record.contextPresets[index - 1];
      const current = record.contextPresets[index];
      if (previous && current && current.contextTokens < previous.contextTokens) {
        context.addIssue({
          code: "custom",
          path: ["contextPresets", index, "contextTokens"],
          message: "Context token budgets must not decrease across presets",
        });
      }
      if (previous && current && current.maxOutputTokens < previous.maxOutputTokens) {
        context.addIssue({
          code: "custom",
          path: ["contextPresets", index, "maxOutputTokens"],
          message: "Output token budgets must not decrease across presets",
        });
      }
    }

    if (record.downloadSize.unit !== "bytes") {
      context.addIssue({ code: "custom", path: ["downloadSize", "unit"], message: "Download size must use bytes" });
    }
    if (record.runtimeMemory.unit !== "bytes") {
      context.addIssue({ code: "custom", path: ["runtimeMemory", "unit"], message: "Runtime memory must use bytes" });
    }

    const hasCompleteVerification = Boolean(record.verifiedAt && record.verifiedWithWebLLMVersion);
    if (record.status === "verified" && !hasCompleteVerification) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Verified models require a verification date and WebLLM version",
      });
    }
    if ((record.verifiedAt && !record.verifiedWithWebLLMVersion) || (!record.verifiedAt && record.verifiedWithWebLLMVersion)) {
      context.addIssue({
        code: "custom",
        path: ["verifiedAt"],
        message: "Verification date and WebLLM version must be provided together",
      });
    }

    if (record.fallbackModelIds.includes(record.id)) {
      context.addIssue({ code: "custom", path: ["fallbackModelIds"], message: "A model cannot fall back to itself" });
    }
    if (new Set(record.fallbackModelIds).size !== record.fallbackModelIds.length) {
      context.addIssue({ code: "custom", path: ["fallbackModelIds"], message: "Fallback model IDs must be unique" });
    }
  });

export type ModelStatus = z.infer<typeof modelStatusSchema>;
export type LanguageSupport = z.infer<typeof languageSupportSchema>;
export type Suitability = z.infer<typeof suitabilitySchema>;
export type Estimate = z.infer<typeof estimateSchema>;
export type ContextPreset = z.infer<typeof contextPresetSchema>;
export type ModelRegistryRecord = z.infer<typeof modelRegistryRecordSchema>;

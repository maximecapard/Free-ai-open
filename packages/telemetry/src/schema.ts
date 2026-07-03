import { z } from "zod";
import { taskCategories } from "@free-ai-open/types";

const technicalSegmentPattern = "[a-z0-9]+(?:-[a-z0-9]+)*";
const telemetryEventPattern = new RegExp(`^${technicalSegmentPattern}\\.${technicalSegmentPattern}(?:\\.${technicalSegmentPattern})?$`);
const modelIdPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const uppercaseErrorCodePattern = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const technicalErrorSlugPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export const telemetryEventNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(telemetryEventPattern, "Telemetry event names must use domain.action or domain.subdomain.action slugs");

export const telemetryTaskSchema = z.enum(taskCategories);

export const telemetryModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(modelIdPattern, "Telemetry model IDs must be technical slugs without spaces");

export const telemetryErrorCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .refine(
    (value) => uppercaseErrorCodePattern.test(value) || technicalErrorSlugPattern.test(value),
    "Telemetry error codes must be uppercase snake case or short technical slugs"
  );

export const telemetryTimestampSchema = z.iso.datetime({ offset: true });

export const telemetryEventSchema = z.object({
  event: telemetryEventNameSchema,
  severity: z.enum(["debug", "info", "warn", "error", "critical"]),
  appVersion: z.string().max(40).optional(),
  backend: z.enum(["webgpu", "wasm", "cpu"]).optional(),
  browserFamily: z.string().max(80).optional(),
  osFamily: z.string().max(80).optional(),
  deviceTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  performanceMode: z.enum(["fast", "balanced", "performance"]).optional(),
  task: telemetryTaskSchema.optional(),
  modelId: telemetryModelIdSchema.optional(),
  errorCode: telemetryErrorCodeSchema.optional(),
  loadTimeMs: z.number().nonnegative().optional(),
  firstTokenMs: z.number().nonnegative().nullable().optional(),
  tokensPerSecond: z.number().nonnegative().optional(),
  fallbackAttempted: z.boolean().optional(),
  fallbackResult: z.enum(["success", "failed", "not_attempted"]).optional(),
  promptLength: z.number().int().nonnegative().optional(),
  responseLength: z.number().int().nonnegative().optional(),
  contentLogged: z.literal(false),
  timestamp: telemetryTimestampSchema.optional(),
}).strict();

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

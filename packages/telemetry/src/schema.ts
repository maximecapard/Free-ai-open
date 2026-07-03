import { z } from "zod";

export const telemetryEventSchema = z.object({
  event: z.string().max(120),
  severity: z.enum(["debug", "info", "warn", "error", "critical"]),
  appVersion: z.string().max(40).optional(),
  backend: z.enum(["webgpu", "wasm", "cpu"]).optional(),
  browserFamily: z.string().max(80).optional(),
  osFamily: z.string().max(80).optional(),
  deviceTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  performanceMode: z.enum(["fast", "balanced", "performance"]).optional(),
  task: z.string().max(80).optional(),
  modelId: z.string().max(160).optional(),
  errorCode: z.string().max(160).optional(),
  loadTimeMs: z.number().nonnegative().optional(),
  firstTokenMs: z.number().nonnegative().nullable().optional(),
  tokensPerSecond: z.number().nonnegative().optional(),
  fallbackAttempted: z.boolean().optional(),
  fallbackResult: z.enum(["success", "failed", "not_attempted"]).optional(),
  promptLength: z.number().int().nonnegative().optional(),
  responseLength: z.number().int().nonnegative().optional(),
  contentLogged: z.literal(false),
  timestamp: z.string().optional(),
}).strict();

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

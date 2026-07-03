import { z } from "zod";

export const modelRecordSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  technicalName: z.string(),
  source: z.enum(["huggingface", "r2", "local", "custom"]),
  modelUrl: z.string(),
  tasks: z.array(z.string()),
  minDeviceTier: z.number().int().min(0).max(4),
  recommendedDeviceTier: z.number().int().min(0).max(4),
  estimatedDownloadGb: z.number().nonnegative(),
  estimatedRamGb: z.number().nonnegative(),
  backend: z.array(z.enum(["webgpu", "wasm", "cpu"])),
  license: z.string(),
  verified: z.boolean(),
  sha256: z.string().optional(),
  status: z.enum(["stable", "experimental", "blocked"]),
});

export type ModelRecord = z.infer<typeof modelRecordSchema>;

export const sampleModels: ModelRecord[] = [
  {
    id: "sample-general-light",
    displayName: "Assistant quotidien léger",
    technicalName: "Sample Browser LLM Q4",
    source: "huggingface",
    modelUrl: "hf://replace-with-compatible-webllm-model",
    tasks: ["chat", "writing", "summarization", "translation"],
    minDeviceTier: 1,
    recommendedDeviceTier: 2,
    estimatedDownloadGb: 1.2,
    estimatedRamGb: 2.5,
    backend: ["webgpu", "wasm"],
    license: "verify-before-use",
    verified: false,
    status: "experimental",
  },
];

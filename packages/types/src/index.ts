export type PerformanceMode = "fast" | "balanced" | "performance";

export const taskCategories = [
  "chat",
  "writing",
  "rewrite",
  "summarization",
  "translation",
  "coding",
  "learning",
  "document_analysis",
] as const;

export type TaskCategory = (typeof taskCategories)[number];

export type Backend = "webgpu" | "wasm" | "cpu";

export type DeviceTier = 0 | 1 | 2 | 3 | 4;

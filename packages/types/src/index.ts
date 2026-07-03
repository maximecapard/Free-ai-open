export type PerformanceMode = "fast" | "balanced" | "performance";

export type TaskCategory =
  | "chat"
  | "writing"
  | "rewrite"
  | "summarization"
  | "translation"
  | "coding"
  | "learning"
  | "document_analysis";

export type Backend = "webgpu" | "wasm" | "cpu";

export type DeviceTier = 0 | 1 | 2 | 3 | 4;

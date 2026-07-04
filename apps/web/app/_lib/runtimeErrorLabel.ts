import type { RuntimeErrorCode } from "@free-ai-open/ai-runtime";

const RUNTIME_ERROR_LABELS: Record<RuntimeErrorCode, string> = {
  webgpu_unavailable: "This browser doesn't support WebGPU, so the local model can't run here yet.",
  model_unsupported: "This model isn't supported by your browser or device.",
  model_load_failed: "The model failed to load. Check your connection and try again.",
  generation_interrupted: "Generation was stopped.",
  out_of_memory: "Your device ran out of memory running the model. Try closing other tabs.",
  unknown: "Something went wrong with the local AI runtime.",
};

export function runtimeErrorLabel(code: RuntimeErrorCode): string {
  return RUNTIME_ERROR_LABELS[code];
}

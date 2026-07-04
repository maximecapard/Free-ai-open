import type { RuntimeError, RuntimeErrorCode } from "./types";

// @mlc-ai/web-llm defines dedicated error classes (WebGPUNotAvailableError,
// DeviceLostError, ModelNotFoundError, ShaderF16SupportError, ...) but only
// exports `IntegrityError` from its public entry point. Every one of those
// classes still sets a stable `error.name` in its own constructor, so we
// match on that instead of `instanceof`, which would require importing
// from the package's internal file layout.
const KNOWN_WEBLLM_ERROR_NAMES: Record<string, RuntimeErrorCode> = {
  WebGPUNotAvailableError: "webgpu_unavailable",
  WebGPUNotFoundError: "webgpu_unavailable",
  ShaderF16SupportError: "gpu_feature_unsupported",
  FeatureSupportError: "gpu_feature_unsupported",
  DeviceLostError: "out_of_memory",
  ModelNotFoundError: "model_unsupported",
  // MissingModelWasmError's constructor actually sets this.name to
  // "MissingModelError" (a naming mismatch in the SDK itself).
  MissingModelError: "model_load_failed",
};

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown runtime error.";
}

function nameOf(error: unknown): string | null {
  return error instanceof Error ? error.name : null;
}

function classifyByMessage(lowerCaseMessage: string, stage: "load" | "generate"): RuntimeErrorCode {
  // Checked before the generic "webgpu" match below so a message like
  // "...WebGPU extension shader-f16..." is not misclassified as
  // webgpu_unavailable when WebGPU itself is actually available.
  if (lowerCaseMessage.includes("shader-f16") || lowerCaseMessage.includes("shader f16")) {
    return "gpu_feature_unsupported";
  }
  if (
    lowerCaseMessage.includes("webgpu") ||
    lowerCaseMessage.includes("gpu adapter") ||
    lowerCaseMessage.includes("requestadapter")
  ) {
    return "webgpu_unavailable";
  }
  if (
    lowerCaseMessage.includes("out of memory") ||
    lowerCaseMessage.includes("out-of-memory") ||
    lowerCaseMessage.includes("oom") ||
    lowerCaseMessage.includes("allocat")
  ) {
    return "out_of_memory";
  }
  if (lowerCaseMessage.includes("abort") || lowerCaseMessage.includes("interrupt")) {
    return "generation_interrupted";
  }
  if (
    lowerCaseMessage.includes("not found in") ||
    lowerCaseMessage.includes("unsupported") ||
    lowerCaseMessage.includes("not supported")
  ) {
    return "model_unsupported";
  }
  return stage === "load" ? "model_load_failed" : "unknown";
}

export function classifyRuntimeError(error: unknown, stage: "load" | "generate"): RuntimeError {
  const name = nameOf(error);
  const knownCode = name ? KNOWN_WEBLLM_ERROR_NAMES[name] : undefined;
  const code = knownCode ?? classifyByMessage(messageOf(error).toLowerCase(), stage);

  return { code, message: messageOf(error) };
}

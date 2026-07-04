import type { RuntimeError, RuntimeErrorCode } from "./types";

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown runtime error.";
}

export function classifyRuntimeError(error: unknown, stage: "load" | "generate"): RuntimeError {
  const message = messageOf(error).toLowerCase();
  let code: RuntimeErrorCode;

  if (message.includes("webgpu") || message.includes("gpu adapter") || message.includes("requestadapter")) {
    code = "webgpu_unavailable";
  } else if (
    message.includes("out of memory") ||
    message.includes("out-of-memory") ||
    message.includes("oom") ||
    message.includes("allocat")
  ) {
    code = "out_of_memory";
  } else if (message.includes("abort") || message.includes("interrupt")) {
    code = "generation_interrupted";
  } else if (message.includes("not found in") || message.includes("unsupported") || message.includes("not supported")) {
    code = "model_unsupported";
  } else if (stage === "load") {
    code = "model_load_failed";
  } else {
    code = "unknown";
  }

  return { code, message: messageOf(error) };
}

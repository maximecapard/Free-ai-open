import { describe, expect, it } from "vitest";
import { classifyRuntimeError } from "./errors";

describe("classifyRuntimeError", () => {
  it("classifies WebGPU-related failures", () => {
    expect(classifyRuntimeError(new Error("WebGPU requestAdapter returned null"), "load").code).toBe(
      "webgpu_unavailable"
    );
  });

  it("classifies out-of-memory failures", () => {
    expect(classifyRuntimeError(new Error("Failed to allocate GPU buffer: out of memory"), "load").code).toBe(
      "out_of_memory"
    );
  });

  it("classifies interrupted generation", () => {
    expect(classifyRuntimeError(new Error("Generation aborted by user"), "generate").code).toBe(
      "generation_interrupted"
    );
  });

  it("classifies unsupported models", () => {
    expect(classifyRuntimeError(new Error("Model xyz not found in appConfig"), "load").code).toBe(
      "model_unsupported"
    );
  });

  it("falls back to model_load_failed for unrecognized load-stage errors", () => {
    expect(classifyRuntimeError(new Error("network error"), "load").code).toBe("model_load_failed");
  });

  it("falls back to unknown for unrecognized generate-stage errors", () => {
    expect(classifyRuntimeError(new Error("something odd happened"), "generate").code).toBe("unknown");
  });

  it("handles non-Error values without throwing", () => {
    expect(classifyRuntimeError("plain string error", "load").code).toBe("model_load_failed");
    expect(classifyRuntimeError(undefined, "generate").code).toBe("unknown");
  });

  it("preserves the original error message", () => {
    expect(classifyRuntimeError(new Error("boom"), "load").message).toBe("boom");
  });
});

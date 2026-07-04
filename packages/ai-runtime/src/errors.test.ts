import { describe, expect, it } from "vitest";
import { classifyRuntimeError } from "./errors";

// @mlc-ai/web-llm does not export its internal error classes (only
// IntegrityError is public), so these helpers build plain Error objects
// with the same `.name` and message wording the real SDK classes set in
// their own constructors, to exercise the name-based classification path
// without depending on package internals.
function webllmError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("classifyRuntimeError", () => {
  describe("known @mlc-ai/web-llm error names", () => {
    it("classifies WebGPUNotAvailableError as webgpu_unavailable", () => {
      const error = webllmError(
        "WebGPUNotAvailableError",
        "WebGPU is not supported in your current environment, but it is necessary to run the WebLLM engine."
      );
      expect(classifyRuntimeError(error, "load").code).toBe("webgpu_unavailable");
    });

    it("classifies WebGPUNotFoundError as webgpu_unavailable", () => {
      const error = webllmError("WebGPUNotFoundError", "Cannot find WebGPU in the environment");
      expect(classifyRuntimeError(error, "load").code).toBe("webgpu_unavailable");
    });

    it("classifies DeviceLostError as out_of_memory", () => {
      const error = webllmError(
        "DeviceLostError",
        "The WebGPU device was lost while loading the model. This issue often occurs due to running out of memory (OOM)."
      );
      expect(classifyRuntimeError(error, "load").code).toBe("out_of_memory");
    });

    it("classifies ModelNotFoundError as model_unsupported", () => {
      const error = webllmError(
        "ModelNotFoundError",
        "Cannot find model record in appConfig for some-model. Please check if the model ID is correct."
      );
      expect(classifyRuntimeError(error, "load").code).toBe("model_unsupported");
    });

    it("classifies the MissingModelWasmError runtime name (MissingModelError) as model_load_failed", () => {
      const error = webllmError(
        "MissingModelError",
        'Missing `model_lib` for the model with ID "some-model".'
      );
      expect(classifyRuntimeError(error, "load").code).toBe("model_load_failed");
    });

    it("classifies ShaderF16SupportError as gpu_feature_unsupported, not webgpu_unavailable", () => {
      const error = webllmError(
        "ShaderF16SupportError",
        "This model requires WebGPU extension shader-f16, which is not enabled in this browser."
      );
      const result = classifyRuntimeError(error, "load");
      expect(result.code).toBe("gpu_feature_unsupported");
      expect(result.code).not.toBe("webgpu_unavailable");
    });

    it("classifies a generic FeatureSupportError as gpu_feature_unsupported", () => {
      const error = webllmError(
        "FeatureSupportError",
        "This model requires feature some-feature, which is not yet supported by this browser."
      );
      expect(classifyRuntimeError(error, "load").code).toBe("gpu_feature_unsupported");
    });
  });

  describe("regression: message-based fallback must not confuse GPU feature gaps with WebGPU absence", () => {
    it("does not classify a shader-f16 message as webgpu_unavailable even without a recognized error name", () => {
      const error = new Error(
        "This model requires WebGPU extension shader-f16, which is not enabled in this browser."
      );
      const result = classifyRuntimeError(error, "load");
      expect(result.code).toBe("gpu_feature_unsupported");
      expect(result.code).not.toBe("webgpu_unavailable");
    });

    it("still classifies a plain WebGPU-absence message as webgpu_unavailable", () => {
      expect(classifyRuntimeError(new Error("WebGPU requestAdapter returned null"), "load").code).toBe(
        "webgpu_unavailable"
      );
    });
  });

  describe("message-based fallback for unrecognized error names", () => {
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
  });

  it("handles non-Error values without throwing", () => {
    expect(classifyRuntimeError("plain string error", "load").code).toBe("model_load_failed");
    expect(classifyRuntimeError(undefined, "generate").code).toBe("unknown");
  });

  it("preserves the original error message", () => {
    expect(classifyRuntimeError(new Error("boom"), "load").message).toBe("boom");
  });

  it("prefers the known error name over message heuristics even when the message is misleading", () => {
    // A WebGPUNotAvailableError-named error whose message does not mention
    // "webgpu" at all should still be classified by its name.
    const error = webllmError("WebGPUNotAvailableError", "generic failure");
    expect(classifyRuntimeError(error, "load").code).toBe("webgpu_unavailable");
  });
});

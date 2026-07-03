import { describe, expect, it } from "vitest";
import type { ModelRecord } from "@free-ai-open/model-registry";
import { routeModel } from "./index";

function buildModel(overrides: Partial<ModelRecord>): ModelRecord {
  return {
    id: "test-model",
    displayName: "Test Model",
    technicalName: "Test Model Q4",
    source: "huggingface",
    modelUrl: "hf://test",
    tasks: ["chat"],
    minDeviceTier: 0,
    recommendedDeviceTier: 2,
    estimatedDownloadGb: 1,
    estimatedRamGb: 2,
    backend: ["wasm"],
    license: "verify-before-use",
    verified: false,
    status: "stable",
    ...overrides,
  };
}

describe("routeModel", () => {
  it("rejects models that do not support the requested task", () => {
    const result = routeModel({
      task: "coding",
      performanceMode: "balanced",
      deviceTier: 2,
      models: [buildModel({ id: "chat-only", tasks: ["chat"] })],
    });

    expect(result.selectedModel).toBeNull();
    expect(result.reasonCode).toBe("no_compatible_model");
    expect(result.rejected).toEqual([{ modelId: "chat-only", reason: "task_not_supported" }]);
  });

  it("rejects models whose minimum device tier exceeds the device tier", () => {
    const result = routeModel({
      task: "chat",
      performanceMode: "balanced",
      deviceTier: 1,
      models: [buildModel({ id: "heavy", tasks: ["chat"], minDeviceTier: 3 })],
    });

    expect(result.selectedModel).toBeNull();
    expect(result.rejected).toEqual([{ modelId: "heavy", reason: "device_tier_too_low" }]);
  });

  it("rejects blocked models", () => {
    const result = routeModel({
      task: "chat",
      performanceMode: "balanced",
      deviceTier: 2,
      models: [buildModel({ id: "blocked", tasks: ["chat"], status: "blocked" })],
    });

    expect(result.selectedModel).toBeNull();
    expect(result.rejected).toEqual([{ modelId: "blocked", reason: "model_blocked" }]);
  });

  it("in fast mode, selects the candidate with the lowest RAM footprint", () => {
    const result = routeModel({
      task: "chat",
      performanceMode: "fast",
      deviceTier: 3,
      models: [
        buildModel({ id: "light", tasks: ["chat"], estimatedRamGb: 1 }),
        buildModel({ id: "heavy", tasks: ["chat"], estimatedRamGb: 8 }),
      ],
    });

    expect(result.selectedModel?.id).toBe("light");
    expect(result.reasonCode).toBe("best_task_fit_for_device_tier");
  });

  it("in performance mode, selects the candidate with the highest recommended device tier", () => {
    const result = routeModel({
      task: "chat",
      performanceMode: "performance",
      deviceTier: 4,
      models: [
        buildModel({ id: "basic", tasks: ["chat"], recommendedDeviceTier: 1 }),
        buildModel({ id: "flagship", tasks: ["chat"], recommendedDeviceTier: 4 }),
      ],
    });

    expect(result.selectedModel?.id).toBe("flagship");
  });

  it("returns null with no_compatible_model when no models are provided", () => {
    const result = routeModel({
      task: "chat",
      performanceMode: "balanced",
      deviceTier: 2,
      models: [],
    });

    expect(result.selectedModel).toBeNull();
    expect(result.reasonCode).toBe("no_compatible_model");
  });
});

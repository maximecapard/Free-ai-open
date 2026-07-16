import { describe, expect, it } from "vitest";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import type { ModelRecord } from "@free-ai-open/model-registry";
import { sampleModels } from "@free-ai-open/model-registry";
import {
  explainModelDecision,
  getFallbackModel,
  rankCompatibleModels,
  rejectIncompatibleModels,
  routeModel,
  selectRecommendedModel,
} from "./index";

function buildDeviceProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  const baseProfile: DeviceProfile = {
    webgpuAvailable: true,
    wasmAvailable: true,
    preferredBackend: "webgpu",
    estimatedMemoryGb: 16,
    storageQuotaGb: 64,
    browserFamily: "chromium",
    osFamily: "windows",
    benchmark: {
      status: "skipped",
      score: null,
      reason: "placeholder",
    },
    deviceTier: 3,
    deviceTierLabel: "webgpu_high",
    formFactor: "desktop",
    architectureClass: "x86",
    memoryClass: "high",
    cpuConcurrencyClass: "high",
  };

  return {
    ...baseProfile,
    ...overrides,
    benchmark: overrides.benchmark ?? baseProfile.benchmark,
    deviceTierLabel: overrides.deviceTierLabel ?? baseProfile.deviceTierLabel,
  };
}

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
    status: "experimental",
    ...overrides,
  };
}

describe("selectRecommendedModel", () => {
  it("returns selectedModel, fallbackModel, rejectedModels, reasonCode, and humanReadableReason", () => {
    const result = selectRecommendedModel({
      task: "chat",
      performanceMode: "balanced",
      deviceProfile: buildDeviceProfile({ deviceTier: 2 }),
      modelRegistry: [
        buildModel({ id: "primary", displayName: "Primary", recommendedDeviceTier: 2 }),
        buildModel({ id: "fallback", displayName: "Fallback", recommendedDeviceTier: 3 }),
      ],
    });

    expect(result.selectedModel?.id).toBe("primary");
    expect(result.fallbackModel?.id).toBe("fallback");
    expect(result.rejectedModels).toEqual([]);
    expect(result.reasonCode).toBe("recommended_model_selected");
    expect(result.humanReadableReason).toContain("Selected Primary");
  });

  it("routes model-registry sample records", () => {
    const result = selectRecommendedModel({
      task: "chat",
      performanceMode: "balanced",
      deviceProfile: buildDeviceProfile({ deviceTier: 2 }),
      modelRegistry: sampleModels,
    });

    expect(result.selectedModel?.id).toBe("sample-general-light");
    expect(result.rejectedModels).toEqual([{ modelId: "sample-coding-light", reason: "task_not_supported" }]);
  });

  it("returns null selected and fallback models when no model is compatible", () => {
    const result = selectRecommendedModel({
      task: "coding",
      performanceMode: "balanced",
      deviceProfile: buildDeviceProfile(),
      modelRegistry: [buildModel({ id: "chat-only", tasks: ["chat"] })],
    });

    expect(result.selectedModel).toBeNull();
    expect(result.fallbackModel).toBeNull();
    expect(result.reasonCode).toBe("no_compatible_model");
    expect(result.humanReadableReason).toContain("No compatible model");
  });
});

describe("rejectIncompatibleModels", () => {
  it("returns explicit rejection reasons for blocked, task, tier, and backend failures", () => {
    const result = rejectIncompatibleModels({
      task: "translation",
      performanceMode: "balanced",
      deviceProfile: buildDeviceProfile({
        deviceTier: 1,
        webgpuAvailable: false,
        preferredBackend: "wasm",
      }),
      modelRegistry: [
        buildModel({ id: "blocked", status: "blocked" }),
        buildModel({ id: "wrong-task", tasks: ["chat"] }),
        buildModel({ id: "too-heavy-tier", tasks: ["translation"], minDeviceTier: 3 }),
        buildModel({ id: "wrong-backend", tasks: ["translation"], estimatedRamGb: 1, backend: ["webgpu"] }),
        buildModel({ id: "compatible", tasks: ["translation"], estimatedRamGb: 1, backend: ["wasm"] }),
      ],
    });

    expect(result.compatibleModels.map((model) => model.id)).toEqual(["compatible"]);
    expect(result.rejectedModels).toEqual([
      { modelId: "blocked", reason: "model_blocked" },
      { modelId: "wrong-task", reason: "task_not_supported" },
      { modelId: "too-heavy-tier", reason: "device_tier_too_low" },
      { modelId: "wrong-backend", reason: "backend_not_available" },
    ]);
  });
});

describe("rankCompatibleModels", () => {
  it("in fast mode, ranks the lowest RAM model first", () => {
    const input = {
      task: "chat" as const,
      performanceMode: "fast" as const,
      deviceProfile: buildDeviceProfile(),
      modelRegistry: [],
    };
    const ranked = rankCompatibleModels(input, [
      buildModel({ id: "medium", estimatedRamGb: 3 }),
      buildModel({ id: "light", estimatedRamGb: 1 }),
      buildModel({ id: "heavy", estimatedRamGb: 8 }),
    ]);

    expect(ranked.map((model) => model.id)).toEqual(["light", "medium", "heavy"]);
  });

  it("in balanced mode, ranks the model closest to the device tier first", () => {
    const input = {
      task: "chat" as const,
      performanceMode: "balanced" as const,
      deviceProfile: buildDeviceProfile({ deviceTier: 3 }),
      modelRegistry: [],
    };
    const ranked = rankCompatibleModels(input, [
      buildModel({ id: "small", recommendedDeviceTier: 1, estimatedRamGb: 1 }),
      buildModel({ id: "fit", recommendedDeviceTier: 3, estimatedRamGb: 4 }),
      buildModel({ id: "large", recommendedDeviceTier: 4, estimatedRamGb: 6 }),
    ]);

    expect(ranked[0]?.id).toBe("fit");
  });

  it("in performance mode, ranks the strongest compatible model first", () => {
    const input = {
      task: "chat" as const,
      performanceMode: "performance" as const,
      deviceProfile: buildDeviceProfile({ deviceTier: 4 }),
      modelRegistry: [],
    };
    const ranked = rankCompatibleModels(input, [
      buildModel({ id: "basic", recommendedDeviceTier: 1, estimatedRamGb: 1 }),
      buildModel({ id: "flagship", recommendedDeviceTier: 4, estimatedRamGb: 8 }),
      buildModel({ id: "mid", recommendedDeviceTier: 3, estimatedRamGb: 4 }),
    ]);

    expect(ranked[0]?.id).toBe("flagship");
  });

  it("uses deterministic tie breakers without mutating the input order", () => {
    const models = [
      buildModel({ id: "beta", estimatedRamGb: 2, estimatedDownloadGb: 1 }),
      buildModel({ id: "alpha", estimatedRamGb: 2, estimatedDownloadGb: 1 }),
    ];

    const ranked = rankCompatibleModels(
      {
        task: "chat",
        performanceMode: "fast",
        deviceProfile: buildDeviceProfile(),
        modelRegistry: models,
      },
      models
    );

    expect(ranked.map((model) => model.id)).toEqual(["alpha", "beta"]);
    expect(models.map((model) => model.id)).toEqual(["beta", "alpha"]);
  });
});

describe("getFallbackModel", () => {
  it("returns the second ranked compatible model", () => {
    const input = {
      task: "chat" as const,
      performanceMode: "fast" as const,
      deviceProfile: buildDeviceProfile(),
      modelRegistry: [],
    };
    const ranked = [
      buildModel({ id: "selected", estimatedRamGb: 1 }),
      buildModel({ id: "fallback", estimatedRamGb: 2 }),
    ];

    expect(getFallbackModel(input, ranked, ranked[0])?.id).toBe("fallback");
  });

  it("returns null when no alternate compatible model exists", () => {
    const input = {
      task: "chat" as const,
      performanceMode: "fast" as const,
      deviceProfile: buildDeviceProfile(),
      modelRegistry: [],
    };
    const ranked = [buildModel({ id: "selected", estimatedRamGb: 1 })];

    expect(getFallbackModel(input, ranked, ranked[0])).toBeNull();
  });
});

describe("explainModelDecision", () => {
  it("explains a selected model decision", () => {
    const input = {
      task: "chat" as const,
      performanceMode: "balanced" as const,
      deviceProfile: buildDeviceProfile({ deviceTier: 2 }),
      modelRegistry: [],
    };
    const selected = buildModel({ id: "selected", displayName: "Selected Model" });
    const fallback = buildModel({ id: "fallback", displayName: "Fallback Model" });

    const explanation = explainModelDecision(input, selected, fallback, []);

    expect(explanation.reasonCode).toBe("recommended_model_selected");
    expect(explanation.humanReadableReason).toContain("Selected Model");
    expect(explanation.humanReadableReason).toContain("Fallback Model");
  });

  it("explains when no compatible model exists", () => {
    const input = {
      task: "coding" as const,
      performanceMode: "balanced" as const,
      deviceProfile: buildDeviceProfile({ deviceTier: 1 }),
      modelRegistry: [],
    };

    const explanation = explainModelDecision(input, null, null, [{ modelId: "chat-only", reason: "task_not_supported" }]);

    expect(explanation.reasonCode).toBe("no_compatible_model");
    expect(explanation.humanReadableReason).toContain("1 model(s)");
  });
});

describe("routeModel", () => {
  it("keeps the legacy wrapper compatible with existing routeModel callers", () => {
    const result = routeModel({
      task: "chat",
      performanceMode: "balanced",
      deviceTier: 2,
      availableBackends: ["wasm"],
      models: [buildModel({ id: "legacy-model", backend: ["wasm"] })],
    });

    expect(result.selectedModel?.id).toBe("legacy-model");
    expect(result.rejected).toEqual(result.rejectedModels);
    expect(result.humanReadableReason).toContain("Test Model");
  });
});

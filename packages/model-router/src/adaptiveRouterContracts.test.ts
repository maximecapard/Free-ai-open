import { describe, expect, it } from "vitest";
import type { RouterDecision, RouterInput } from "./adaptiveRouterContracts";
import { selectRecommendedModel } from "./router";

const exampleCapability: RouterInput["capability"] = {
  schemaVersion: 1,
  detectedAt: "2026-07-17T10:00:00.000Z",
  formFactor: "desktop",
  architectureClass: "x86",
  browserFamily: "chrome",
  osFamily: "windows",
  webgpuAvailable: true,
  wasmAvailable: true,
  gpu: { featureClasses: [], limitClasses: {} },
  confidence: "medium",
};

describe("RouterInput contract", () => {
  it("is a usable shape carrying only task/locale/mode/capability/technical signals", () => {
    const input: RouterInput = {
      task: "coding",
      locale: "fr",
      performanceMode: "balanced",
      capability: exampleCapability,
      observations: [],
      cachedModelIds: ["sample-general-light"],
    };

    expect(input.task).toBe("coding");
    expect(input.locale).toBe("fr");
  });

  it("never contains prompt/response/conversation-shaped fields", () => {
    const input: RouterInput = {
      task: "chat",
      locale: "en",
      performanceMode: "fast",
      capability: exampleCapability,
      observations: [],
      cachedModelIds: [],
      manualModelId: "sample-general-light",
    };

    const serialized = JSON.stringify(input).toLowerCase();
    for (const forbidden of ["prompt", "response", "message", "conversation", "document"]) {
      expect(serialized).not.toContain(`"${forbidden}`);
    }
  });

  it("coexists with the active v0.6 router without changing its behavior", () => {
    // Phase 0 only adds contracts; selectRecommendedModel is unchanged and
    // still takes the v0.6 ModelRouterInput shape, not RouterInput.
    const result = selectRecommendedModel({
      task: "chat",
      performanceMode: "balanced",
      deviceProfile: {
        webgpuAvailable: true,
        wasmAvailable: true,
        preferredBackend: "webgpu",
        browserFamily: "chrome",
        osFamily: "windows",
        benchmark: { status: "skipped", score: null, reason: "placeholder" },
        deviceTier: 2,
        deviceTierLabel: "webgpu_medium",
        formFactor: "desktop",
        architectureClass: "x86",
        memoryClass: "medium",
        cpuConcurrencyClass: "medium",
      },
      modelRegistry: [],
    });

    expect(result.selectedModel).toBeNull();
    expect(result.reasonCode).toBe("no_compatible_model");
  });
});

describe("RouterDecision contract", () => {
  it("is a usable, versioned decision shape with human-readable reasons", () => {
    const decision: RouterDecision = {
      selectedModelId: "sample-general-light",
      fallbackModelIds: ["sample-coding-light"],
      confidence: "medium",
      reasons: ["Matches task and performance mode."],
      warnings: [],
      recommendedContextTokens: 2048,
      recommendedMaxOutputTokens: 512,
      decisionVersion: "v1",
    };

    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.fallbackModelIds).not.toContain(decision.selectedModelId);
  });
});

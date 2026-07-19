import { describe, expect, it } from "vitest";
import type { RouterInput } from "./adaptiveRouterContracts";
import { normalizeRouterInput } from "./adaptiveNormalization";

const NOW = new Date("2026-07-19T10:00:00.000Z");

function inputWithCapability(capability: RouterInput["capability"]): RouterInput {
  return {
    task: "chat",
    locale: "en",
    performanceMode: "balanced",
    capability,
    observations: [],
    cachedModelIds: [],
    registryVersion: "0.7.0-alpha.1",
  };
}

describe("normalizeRouterInput", () => {
  it("rebuilds capability data from strict coarse allowlists", () => {
    const capability = {
      schemaVersion: 2,
      detectedAt: "2026-07-19T09:00:00.000Z",
      expiresAt: "2026-07-26T09:00:00.000Z",
      formFactor: "desktop",
      architectureClass: "x86",
      browserFamily: "chromium",
      osFamily: "windows",
      memoryClass: "high",
      logicalProcessorClass: "high",
      approximateMemoryGB: 16,
      logicalProcessors: 12,
      webgpuAvailable: true,
      wasmAvailable: true,
      fallbackAdapter: false,
      capabilityClass: "performance",
      deviceTier: 4,
      gpu: {
        vendorClass: "Confidential uploaded document text",
        featureClasses: ["shader-f16", "private-prompt-text"],
        limitClasses: { maxBufferSize: "high", documentContent: "high" },
        rawDescription: "private driver string",
      },
      confidence: "high",
      prompt: "private prompt",
    } as unknown as RouterInput["capability"];

    const normalized = normalizeRouterInput(
      inputWithCapability(capability) as RouterInput & { conversation?: string },
      new Set(["safe-model"]),
      "0.7.0-alpha.1",
      NOW
    );

    expect(normalized.capability.gpu).toEqual({
      featureClasses: ["shader-f16"],
      limitClasses: { maxBufferSize: "high" },
    });
    expect(normalized.capability.confidence).toBe("low");
    expect(JSON.stringify(normalized)).not.toMatch(/Confidential|documentContent|private|rawDescription|prompt/);
  });

  it("lowers confidence when a nominal GPU class is not allowlisted", () => {
    const capability = {
      schemaVersion: 2,
      detectedAt: "2026-07-19T09:00:00.000Z",
      expiresAt: "2026-07-26T09:00:00.000Z",
      formFactor: "desktop",
      architectureClass: "x86",
      browserFamily: "chromium",
      osFamily: "windows",
      memoryClass: "high",
      logicalProcessorClass: "high",
      webgpuAvailable: true,
      wasmAvailable: true,
      capabilityClass: "performance",
      deviceTier: 4,
      gpu: {
        vendorClass: "Confidential uploaded document text",
        featureClasses: [],
        limitClasses: {},
      },
      confidence: "high",
    } as unknown as RouterInput["capability"];

    const normalized = normalizeRouterInput(
      inputWithCapability(capability),
      new Set(["safe-model"]),
      "0.7.0-alpha.1",
      NOW
    );

    expect(normalized.capability.gpu.vendorClass).toBeUndefined();
    expect(normalized.capability.confidence).toBe("low");
  });
});

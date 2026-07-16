import { describe, expect, it } from "vitest";
import {
  getRecommendedChatPath,
  getRecommendedPerformanceModeForProfile,
  describeDeviceCapability,
  recommendPerformanceMode,
} from "./deviceRecommendation";

describe("recommendPerformanceMode", () => {
  it("recommends fast for the lowest tiers", () => {
    expect(recommendPerformanceMode(0)).toBe("fast");
    expect(recommendPerformanceMode(1)).toBe("fast");
  });

  it("recommends balanced for the middle tiers", () => {
    expect(recommendPerformanceMode(2)).toBe("balanced");
    expect(recommendPerformanceMode(3)).toBe("balanced");
  });

  it("recommends performance for the top tier", () => {
    expect(recommendPerformanceMode(4)).toBe("performance");
  });
});

describe("recommended chat path", () => {
  it("resolves tier 0 and 1 devices to the fast chat destination", () => {
    expect(getRecommendedChatPath({ deviceTier: 0 })).toBe("/chat?task=chat&mode=fast");
    expect(getRecommendedChatPath({ deviceTier: 1 })).toBe("/chat?task=chat&mode=fast");
  });

  it("resolves ordinary supported devices to the balanced chat destination", () => {
    expect(getRecommendedChatPath({ deviceTier: 2 })).toBe("/chat?task=chat&mode=balanced");
    expect(getRecommendedChatPath({ deviceTier: 3 })).toBe("/chat?task=chat&mode=balanced");
  });

  it("resolves strong devices to the performance chat destination", () => {
    expect(getRecommendedChatPath({ deviceTier: 4 })).toBe("/chat?task=chat&mode=performance");
  });

  it("does not hardcode balanced while profiling is pending", () => {
    expect(getRecommendedChatPath(null)).toBeNull();
  });

  it("uses the same mode source as onboarding recommendations", () => {
    const tiers: Array<0 | 1 | 2 | 3 | 4> = [0, 1, 2, 3, 4];
    for (const deviceTier of tiers) {
      expect(getRecommendedChatPath({ deviceTier })).toBe(
        `/chat?task=chat&mode=${getRecommendedPerformanceModeForProfile({ deviceTier })}`
      );
    }
  });
});

describe("describeDeviceCapability", () => {
  it("is limited whenever WebGPU is unavailable, regardless of tier", () => {
    expect(describeDeviceCapability(false, 0)).toBe("limited");
    expect(describeDeviceCapability(false, 4)).toBe("limited");
  });

  it("matches the lightweight category to the fast-mode tier range", () => {
    expect(describeDeviceCapability(true, 0)).toBe("lightweight");
    expect(describeDeviceCapability(true, 1)).toBe("lightweight");
  });

  it("matches the recommended category to the balanced-mode tier range", () => {
    expect(describeDeviceCapability(true, 2)).toBe("recommended");
    expect(describeDeviceCapability(true, 3)).toBe("recommended");
  });

  it("matches the high-performance category to the performance-mode tier", () => {
    expect(describeDeviceCapability(true, 4)).toBe("highPerformance");
  });

  it("always stays consistent with recommendPerformanceMode's own tier boundaries", () => {
    const tiers: Array<0 | 1 | 2 | 3 | 4> = [0, 1, 2, 3, 4];
    for (const tier of tiers) {
      const capability = describeDeviceCapability(true, tier);
      const mode = recommendPerformanceMode(tier);
      if (mode === "fast") expect(capability).toBe("lightweight");
      if (mode === "balanced") expect(capability).toBe("recommended");
      if (mode === "performance") expect(capability).toBe("highPerformance");
    }
  });
});

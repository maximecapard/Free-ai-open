import { describe, expect, it } from "vitest";
import {
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

describe("getRecommendedPerformanceModeForProfile", () => {
  it("delegates to recommendPerformanceMode using the profile's device tier", () => {
    const tiers: Array<0 | 1 | 2 | 3 | 4> = [0, 1, 2, 3, 4];
    for (const deviceTier of tiers) {
      expect(getRecommendedPerformanceModeForProfile({ deviceTier })).toBe(recommendPerformanceMode(deviceTier));
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

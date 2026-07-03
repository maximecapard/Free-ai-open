import { describe, expect, it } from "vitest";
import {
  buildDeviceProfile,
  detectBrowserInfo,
  detectWebGPUAvailability,
  estimateDeviceMemory,
  estimateStorageQuota,
  getDeviceTier,
  runLightweightBenchmark,
} from "./index";
import type { NavigatorLike } from "./index";

const GB = 1024 ** 3;

function buildNavigator(overrides: Partial<NavigatorLike> = {}): NavigatorLike {
  return {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
    userAgentData: {
      platform: "Windows",
      brands: [{ brand: "Chromium" }],
    },
    ...overrides,
  };
}

describe("detectWebGPUAvailability", () => {
  it("detects WebGPU when requestAdapter returns an adapter", async () => {
    const result = await detectWebGPUAvailability(
      buildNavigator({
        gpu: { requestAdapter: async () => ({ name: "adapter" }) },
      })
    );

    expect(result).toBe(true);
  });

  it("returns false when WebGPU is absent or adapter detection fails", async () => {
    await expect(detectWebGPUAvailability(buildNavigator())).resolves.toBe(false);
    await expect(
      detectWebGPUAvailability(
        buildNavigator({
          gpu: {
            requestAdapter: async () => {
              throw new Error("adapter unavailable");
            },
          },
        })
      )
    ).resolves.toBe(false);
  });
});

describe("estimateDeviceMemory", () => {
  it("returns approximate memory when navigator.deviceMemory is available", () => {
    expect(estimateDeviceMemory(buildNavigator({ deviceMemory: 4 }))).toBe(4);
    expect(estimateDeviceMemory(buildNavigator({ deviceMemory: 8 }))).toBe(8);
    expect(estimateDeviceMemory(buildNavigator({ deviceMemory: 16 }))).toBe(16);
  });

  it("returns undefined for missing or invalid memory values", () => {
    expect(estimateDeviceMemory(buildNavigator())).toBeUndefined();
    expect(estimateDeviceMemory(buildNavigator({ deviceMemory: 0 }))).toBeUndefined();
  });
});

describe("estimateStorageQuota", () => {
  it("returns rounded storage quota in GB when available", async () => {
    const result = await estimateStorageQuota(
      buildNavigator({
        storage: { estimate: async () => ({ quota: 12.25 * GB }) },
      })
    );

    expect(result).toBe(12.3);
  });

  it("returns undefined when storage estimation is unavailable or fails", async () => {
    await expect(estimateStorageQuota(buildNavigator())).resolves.toBeUndefined();
    await expect(
      estimateStorageQuota(
        buildNavigator({
          storage: {
            estimate: async () => {
              throw new Error("quota unavailable");
            },
          },
        })
      )
    ).resolves.toBeUndefined();
  });
});

describe("detectBrowserInfo", () => {
  it("returns approximate browser and OS families without versions", () => {
    expect(
      detectBrowserInfo(
        buildNavigator({
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
          userAgentData: undefined,
        })
      )
    ).toEqual({ browserFamily: "safari", osFamily: "macos" });
  });

  it("returns unknown families when browser APIs are unavailable", () => {
    expect(detectBrowserInfo(undefined)).toEqual({ browserFamily: "unknown", osFamily: "unknown" });
  });
});

describe("runLightweightBenchmark", () => {
  it("is a safe placeholder that does not run heavy work", () => {
    expect(runLightweightBenchmark()).toEqual({
      status: "skipped",
      score: null,
      reason: "placeholder",
    });
  });
});

describe("getDeviceTier", () => {
  it("returns cpu_only when WebGPU is unavailable", () => {
    expect(getDeviceTier({ webgpuAvailable: false, wasmAvailable: true, estimatedMemoryGb: 16 })).toEqual({
      tier: 0,
      label: "cpu_only",
    });
  });

  it("classifies WebGPU devices into typed tiers", () => {
    expect(getDeviceTier({ webgpuAvailable: true, wasmAvailable: true, estimatedMemoryGb: 2 })).toEqual({
      tier: 1,
      label: "webgpu_low",
    });
    expect(getDeviceTier({ webgpuAvailable: true, wasmAvailable: true, estimatedMemoryGb: 4 })).toEqual({
      tier: 2,
      label: "webgpu_medium",
    });
    expect(getDeviceTier({ webgpuAvailable: true, wasmAvailable: true, estimatedMemoryGb: 8 })).toEqual({
      tier: 3,
      label: "webgpu_high",
    });
    expect(
      getDeviceTier({
        webgpuAvailable: true,
        wasmAvailable: true,
        estimatedMemoryGb: 16,
        storageQuotaGb: 16,
      })
    ).toEqual({
      tier: 4,
      label: "desktop_power",
    });
  });
});

describe("buildDeviceProfile", () => {
  it("builds a complete profile from mocked browser APIs", async () => {
    const result = await buildDeviceProfile({
      webAssemblyAvailable: true,
      navigator: buildNavigator({
        deviceMemory: 8,
        gpu: { requestAdapter: async () => ({ name: "adapter" }) },
        storage: { estimate: async () => ({ quota: 20 * GB }) },
      }),
    });

    expect(result).toEqual({
      webgpuAvailable: true,
      wasmAvailable: true,
      preferredBackend: "webgpu",
      estimatedMemoryGb: 8,
      storageQuotaGb: 20,
      browserFamily: "chromium",
      osFamily: "windows",
      benchmark: {
        status: "skipped",
        score: null,
        reason: "placeholder",
      },
      deviceTier: 3,
      deviceTierLabel: "webgpu_high",
    });
  });

  it("returns a conservative fallback profile when browser APIs are unavailable", async () => {
    const result = await buildDeviceProfile({
      webAssemblyAvailable: false,
    });

    expect(result).toEqual({
      webgpuAvailable: false,
      wasmAvailable: false,
      preferredBackend: "cpu",
      browserFamily: "unknown",
      osFamily: "unknown",
      benchmark: {
        status: "skipped",
        score: null,
        reason: "placeholder",
      },
      deviceTier: 0,
      deviceTierLabel: "cpu_only",
    });
  });
});

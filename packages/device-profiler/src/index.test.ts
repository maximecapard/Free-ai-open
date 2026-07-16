import { describe, expect, it } from "vitest";
import {
  buildDeviceProfile,
  classifyCpuConcurrency,
  classifyMemory,
  detectArchitectureClass,
  detectBrowserInfo,
  detectCpuConcurrency,
  detectFormFactor,
  detectWebGPUAvailability,
  estimateDeviceMemory,
  estimateStorageQuota,
  getDeviceTier,
  getDeviceTierDisplayLabel,
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

describe("detectFormFactor", () => {
  it("detects mobile from a UA-CH mobile hint", () => {
    expect(
      detectFormFactor(buildNavigator({ userAgentData: { platform: "Android", brands: [], mobile: true } }))
    ).toBe("mobile");
  });

  it("detects mobile from a mobile-flavored user agent string", () => {
    expect(
      detectFormFactor(
        buildNavigator({
          userAgent: "Mozilla/5.0 (Linux; Android 14; Redmi Note 13 Pro 5G) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
          userAgentData: undefined,
        })
      )
    ).toBe("mobile");
  });

  it("detects tablet from an Android user agent without the Mobile token", () => {
    expect(
      detectFormFactor(
        buildNavigator({
          userAgent: "Mozilla/5.0 (Linux; Android 14; Tab A9) AppleWebKit/537.36 Chrome/125 Safari/537.36",
          userAgentData: undefined,
        })
      )
    ).toBe("tablet");
  });

  it("detects desktop from a UA-CH non-mobile hint", () => {
    expect(
      detectFormFactor(buildNavigator({ userAgentData: { platform: "Windows", brands: [], mobile: false } }))
    ).toBe("desktop");
  });

  it("detects desktop from a known desktop OS family when UA-CH mobile hint is unavailable", () => {
    expect(detectFormFactor(buildNavigator({ userAgentData: undefined }))).toBe("desktop");
  });

  it("falls back to unknown when no signal is available", () => {
    expect(detectFormFactor(undefined)).toBe("unknown");
  });
});

describe("detectArchitectureClass", () => {
  it("returns arm when Client Hints reports an ARM architecture", async () => {
    const result = await detectArchitectureClass(
      buildNavigator({
        userAgentData: { platform: "Android", brands: [], getHighEntropyValues: async () => ({ architecture: "arm" }) },
      })
    );
    expect(result).toBe("arm");
  });

  it("returns x86 when Client Hints reports an x86 architecture", async () => {
    const result = await detectArchitectureClass(
      buildNavigator({
        userAgentData: { platform: "Windows", brands: [], getHighEntropyValues: async () => ({ architecture: "x86" }) },
      })
    );
    expect(result).toBe("x86");
  });

  it("falls back to unknown when Client Hints is unavailable, denied, or errors", async () => {
    await expect(detectArchitectureClass(buildNavigator({ userAgentData: undefined }))).resolves.toBe("unknown");
    await expect(
      detectArchitectureClass(
        buildNavigator({
          userAgentData: {
            platform: "Windows",
            brands: [],
            getHighEntropyValues: async () => {
              throw new Error("denied");
            },
          },
        })
      )
    ).resolves.toBe("unknown");
  });
});

describe("classifyMemory / classifyCpuConcurrency / detectCpuConcurrency", () => {
  it("buckets memory into coarse classes", () => {
    expect(classifyMemory(undefined)).toBe("unknown");
    expect(classifyMemory(2)).toBe("low");
    expect(classifyMemory(6)).toBe("medium");
    expect(classifyMemory(12)).toBe("high");
  });

  it("buckets CPU concurrency into coarse classes", () => {
    expect(classifyCpuConcurrency(undefined)).toBe("unknown");
    expect(classifyCpuConcurrency(2)).toBe("low");
    expect(classifyCpuConcurrency(8)).toBe("medium");
    expect(classifyCpuConcurrency(16)).toBe("high");
  });

  it("reads hardwareConcurrency safely, ignoring invalid values", () => {
    expect(detectCpuConcurrency(buildNavigator({ hardwareConcurrency: 8 }))).toBe(8);
    expect(detectCpuConcurrency(buildNavigator({ hardwareConcurrency: 0 }))).toBeUndefined();
    expect(detectCpuConcurrency(buildNavigator())).toBeUndefined();
  });
});

describe("getDeviceTier", () => {
  it("returns cpu_only when WebGPU is unavailable, regardless of memory", () => {
    expect(getDeviceTier({ webgpuAvailable: false, wasmAvailable: true, estimatedMemoryGb: 16 })).toEqual({
      tier: 0,
      label: "cpu_only",
    });
  });

  it("never grants tier 3 from memory alone, even at very high memory", () => {
    const result = getDeviceTier({ webgpuAvailable: true, wasmAvailable: true, estimatedMemoryGb: 64 });
    expect(result.tier).toBeLessThan(3);
  });

  it("classifies WebGPU devices into typed tiers using coarse memory/CPU signals", () => {
    expect(getDeviceTier({ webgpuAvailable: true, wasmAvailable: true, estimatedMemoryGb: 2 })).toEqual({
      tier: 1,
      label: "webgpu_low",
    });
    expect(getDeviceTier({ webgpuAvailable: true, wasmAvailable: true, estimatedMemoryGb: 4 })).toEqual({
      tier: 2,
      label: "webgpu_medium",
    });
    expect(
      getDeviceTier({
        webgpuAvailable: true,
        wasmAvailable: true,
        estimatedMemoryGb: 16,
        formFactor: "desktop",
        cpuConcurrency: 16,
      })
    ).toEqual({ tier: 4, label: "desktop_power" });
  });

  it("does not automatically classify a 12 GB mobile phone as tier 3", () => {
    const result = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 12,
      cpuConcurrency: 8,
      formFactor: "mobile",
    });
    expect(result.tier).toBeLessThanOrEqual(2);
  });

  it("lets a 12 GB desktop reach a different, higher tier than an identical-memory mobile", () => {
    const mobile = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 12,
      cpuConcurrency: 8,
      formFactor: "mobile",
    });
    const desktop = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 12,
      cpuConcurrency: 8,
      formFactor: "desktop",
    });
    expect(desktop.tier).toBeGreaterThan(mobile.tier);
  });

  it("keeps a low-memory desktop conservative", () => {
    const result = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 2,
      cpuConcurrency: 4,
      formFactor: "desktop",
    });
    expect(result.tier).toBe(1);
  });

  it("keeps a mobile device with WebGPU but no measurements conservative even at high coarse scores", () => {
    const result = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 16,
      cpuConcurrency: 12,
      formFactor: "mobile",
    });
    expect(result.tier).toBeLessThanOrEqual(2);
  });

  it("lets strong measured performance promote a mobile device beyond its form-factor cap", () => {
    const withoutMeasurement = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 12,
      cpuConcurrency: 8,
      formFactor: "mobile",
    });
    const withStrongMeasurement = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 12,
      cpuConcurrency: 8,
      formFactor: "mobile",
      measuredPerformance: { tokensPerSecond: 25 },
    });
    expect(withStrongMeasurement.tier).toBeGreaterThan(withoutMeasurement.tier);
  });

  it("does not promote a mobile device on weak measured performance", () => {
    const result = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 12,
      cpuConcurrency: 8,
      formFactor: "mobile",
      measuredPerformance: { tokensPerSecond: 2 },
    });
    expect(result.tier).toBeLessThanOrEqual(2);
  });

  it("demotes a profile after repeated recent stalls/failures", () => {
    const stable = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 8,
      cpuConcurrency: 8,
      formFactor: "desktop",
    });
    const unstable = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 8,
      cpuConcurrency: 8,
      formFactor: "desktop",
      measuredPerformance: { recentFailureCount: 3 },
    });
    expect(unstable.tier).toBe(stable.tier - 1);
  });

  it("never demotes below tier 1 for a WebGPU-capable device", () => {
    const result = getDeviceTier({
      webgpuAvailable: true,
      wasmAvailable: true,
      estimatedMemoryGb: 1,
      formFactor: "mobile",
      measuredPerformance: { recentFailureCount: 10 },
    });
    expect(result.tier).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a safe, conservative tier when form factor and CPU concurrency are unavailable", () => {
    const result = getDeviceTier({ webgpuAvailable: true, wasmAvailable: true });
    expect(result.tier).toBe(1);
  });
});

describe("getDeviceTierDisplayLabel", () => {
  it("shows a WASM/CPU fallback label instead of the misleading cpu_only slug", () => {
    expect(getDeviceTierDisplayLabel("cpu_only", "wasm")).toBe("WASM/CPU fallback");
  });

  it("passes through cpu_only unchanged when there is no WASM fallback either", () => {
    expect(getDeviceTierDisplayLabel("cpu_only", "cpu")).toBe("cpu_only");
  });

  it("passes through WebGPU tier labels unchanged", () => {
    expect(getDeviceTierDisplayLabel("webgpu_high", "webgpu")).toBe("webgpu_high");
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
      deviceTier: 2,
      deviceTierLabel: "webgpu_medium",
      formFactor: "desktop",
      architectureClass: "unknown",
      memoryClass: "high",
      cpuConcurrencyClass: "unknown",
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
      formFactor: "unknown",
      architectureClass: "unknown",
      memoryClass: "unknown",
      cpuConcurrencyClass: "unknown",
    });
  });

  it("prefers wasm when WebGPU is unavailable but WebAssembly is, even though the tier is still cpu_only", async () => {
    const result = await buildDeviceProfile({
      webAssemblyAvailable: true,
      navigator: buildNavigator(),
    });

    expect(result.preferredBackend).toBe("wasm");
    expect(result.deviceTier).toBe(0);
    expect(result.deviceTierLabel).toBe("cpu_only");
    expect(getDeviceTierDisplayLabel(result.deviceTierLabel, result.preferredBackend)).toBe("WASM/CPU fallback");
  });

  it("does not classify a 12 GB Android phone as desktop-class tier 3 on memory alone", async () => {
    const result = await buildDeviceProfile({
      webAssemblyAvailable: true,
      navigator: buildNavigator({
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Redmi Note 13 Pro 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
        userAgentData: undefined,
        deviceMemory: 12,
        hardwareConcurrency: 8,
        gpu: { requestAdapter: async () => ({ name: "adapter" }) },
      }),
    });

    expect(result.formFactor).toBe("mobile");
    expect(result.memoryClass).toBe("high");
    expect(result.deviceTier).toBeLessThanOrEqual(2);
  });

  it("promotes a mobile device when the caller passes real measured performance", async () => {
    const environment = {
      webAssemblyAvailable: true,
      navigator: buildNavigator({
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Redmi Note 13 Pro 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
        userAgentData: undefined,
        deviceMemory: 12,
        hardwareConcurrency: 8,
        gpu: { requestAdapter: async () => ({ name: "adapter" }) },
      }),
    };

    const withoutMeasurement = await buildDeviceProfile(environment);
    const withMeasurement = await buildDeviceProfile({
      ...environment,
      measuredPerformance: { tokensPerSecond: 25 },
    });

    expect(withMeasurement.deviceTier).toBeGreaterThan(withoutMeasurement.deviceTier);
    expect(withMeasurement.measuredPerformance).toEqual({ tokensPerSecond: 25 });
    expect(withoutMeasurement.measuredPerformance).toBeUndefined();
  });

  it("only exposes coarse capability categories, never a raw hardware fingerprint", async () => {
    const result = await buildDeviceProfile({
      webAssemblyAvailable: true,
      navigator: buildNavigator({
        deviceMemory: 12,
        hardwareConcurrency: 8,
        gpu: { requestAdapter: async () => ({ name: "adapter" }) },
      }),
    });

    expect(["mobile", "tablet", "desktop", "unknown"]).toContain(result.formFactor);
    expect(["arm", "x86", "unknown"]).toContain(result.architectureClass);
    expect(["low", "medium", "high", "unknown"]).toContain(result.memoryClass);
    expect(["low", "medium", "high", "unknown"]).toContain(result.cpuConcurrencyClass);
    expect(result).not.toHaveProperty("hardwareConcurrency");
    expect(result).not.toHaveProperty("userAgent");
    expect(result).not.toHaveProperty("maxTouchPoints");
  });
});

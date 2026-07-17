import { describe, expect, it } from "vitest";
import { buildCapabilityProfileKey, classifyResponsiveness, classifyStability, computeNormalizedScore, median, workloadForFormFactor } from "./scoring";
import type { StaticCapabilityProfile } from "@free-ai-open/types";

const profile = {
  formFactor: "desktop",
  capabilityClass: "balanced",
  webgpuAvailable: true,
  fallbackAdapter: false,
} as StaticCapabilityProfile;

describe("local benchmark scoring", () => {
  it("uses a reduced workload for mobile, tablet, and unknown form factors", () => {
    expect(workloadForFormFactor("mobile").elementCount).toBeLessThan(workloadForFormFactor("desktop").elementCount);
    expect(workloadForFormFactor("tablet")).toEqual(workloadForFormFactor("mobile"));
    expect(workloadForFormFactor("unknown")).toEqual(workloadForFormFactor("mobile"));
  });

  it("computes a deterministic bounded score", () => {
    const config = workloadForFormFactor("desktop");
    expect(computeNormalizedScore(100, config)).toBeGreaterThan(0);
    expect(computeNormalizedScore(0, config)).toBe(0);
    expect(computeNormalizedScore(0.001, config)).toBe(100);
  });

  it("uses the median and classifies sample stability", () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(classifyStability([10, 11, 12])).toBe("stable");
    expect(classifyStability([10, 20, 40])).toBe("degraded");
  });

  it("classifies only coarse responsiveness buckets", () => {
    expect(classifyResponsiveness(50)).toBe("responsive");
    expect(classifyResponsiveness(200)).toBe("degraded");
    expect(classifyResponsiveness(500)).toBe("poor");
  });

  it("builds a coarse non-identifying profile key", () => {
    expect(buildCapabilityProfileKey(profile)).toBe("desktop:balanced:webgpu:native");
  });
});

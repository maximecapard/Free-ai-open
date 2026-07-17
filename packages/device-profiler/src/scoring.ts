import type { DeviceTier } from "@free-ai-open/types";
import { classifyCpuConcurrency, classifyMemory } from "./capabilities";
import type {
  CapabilityClass,
  CpuConcurrencyClass,
  DeviceTierInfo,
  DeviceTierInput,
  DeviceTierLabel,
  FormFactor,
  GpuLimitClass,
  MemoryClass,
} from "./types";

const DEVICE_TIER_LABELS: Record<DeviceTier, DeviceTierLabel> = {
  0: "cpu_only",
  1: "webgpu_low",
  2: "webgpu_medium",
  3: "webgpu_high",
  4: "desktop_power",
};

// Each coarse signal contributes a small, bounded number of points so no
// single signal — least of all memory — can dominate the result. Memory and
// CPU concurrency are capped at 2 points each; WebGPU availability itself
// only ever contributes its fixed baseline point (rule: "WebGPU availability
// alone does not prove high performance").
const MEMORY_SCORE: Record<MemoryClass, number> = { low: 0, medium: 1, high: 2, unknown: 0 };
const CPU_SCORE: Record<CpuConcurrencyClass, number> = { low: 0, medium: 1, high: 2, unknown: 0 };
const WEBGPU_BASELINE_SCORE = 1;
const HIGH_LIMIT_CLASSES = new Set<GpuLimitClass>(["high", "very_high"]);

// Mobile/tablet/unknown form factors cap the *coarse-signal* tier so RAM and
// core count alone can never place a phone alongside desktop-class hardware
// (rule: "RAM alone must never grant Tier 3"; "mobile ... conservative
// initial capability penalty"). `null` means no cap (desktop). Measured
// performance (see below) can still lift a device above its cap.
const FORM_FACTOR_TIER_CAP: Record<FormFactor, DeviceTier | null> = {
  mobile: 2,
  tablet: 3,
  desktop: null,
  unknown: 3,
};

// Thresholds for promoting a device on real measured tokens/sec. These are
// deliberately conservative: a moderate result only lifts the device one
// tier past its form-factor cap, and even a strong result never exceeds what
// the coarse signals already independently suggested (uncappedTier) — a
// measurement can remove the conservative penalty, but it does not invent
// capability the coarse signals gave no evidence for.
const STRONG_TOKENS_PER_SECOND = 20;
const MODERATE_TOKENS_PER_SECOND = 8;

// A device that has recently stalled or failed repeatedly is demoted by one
// tier as a safety margin, never below tier 1 (tier 0 is reserved for "no
// WebGPU at all", which recent failures on a WebGPU-capable device don't
// change).
const STABILITY_DEMOTE_FAILURE_COUNT = 2;

function scoreToUncappedTier(score: number): DeviceTier {
  if (score <= 1) return 1;
  if (score <= 3) return 2;
  if (score === 4) return 3;
  return 4;
}

function computeCapabilityScore(input: DeviceTierInput): number {
  const memoryScore = MEMORY_SCORE[classifyMemory(input.estimatedMemoryGb)];
  const cpuScore = CPU_SCORE[classifyCpuConcurrency(input.cpuConcurrency)];
  const featureScore = input.gpuFeatureClasses?.includes("shader-f16") ? 1 : 0;
  const limitValues = Object.values(input.gpuLimitClasses ?? {});
  const limitScore = limitValues.some((value) => HIGH_LIMIT_CLASSES.has(value)) ? 1 : 0;
  return memoryScore + cpuScore + WEBGPU_BASELINE_SCORE + featureScore + limitScore;
}

function applyMeasuredPromotion(cappedTier: DeviceTier, uncappedTier: DeviceTier, input: DeviceTierInput): DeviceTier {
  if (input.fallbackAdapter) return cappedTier;
  const tokensPerSecond = input.measuredPerformance?.tokensPerSecond;
  if (tokensPerSecond === undefined) return cappedTier;

  if (tokensPerSecond >= STRONG_TOKENS_PER_SECOND) {
    return Math.max(cappedTier, uncappedTier) as DeviceTier;
  }
  if (tokensPerSecond >= MODERATE_TOKENS_PER_SECOND) {
    return Math.max(cappedTier, Math.min(uncappedTier, cappedTier + 1)) as DeviceTier;
  }
  return cappedTier;
}

function applyStabilityDemotion(tier: DeviceTier, input: DeviceTierInput): DeviceTier {
  const recentFailureCount = input.measuredPerformance?.recentFailureCount;
  if (recentFailureCount === undefined || recentFailureCount < STABILITY_DEMOTE_FAILURE_COUNT) return tier;
  return Math.max(1, tier - 1) as DeviceTier;
}

export function getDeviceTier(input: DeviceTierInput): DeviceTierInfo {
  if (!input.webgpuAvailable) {
    return { tier: 0, label: DEVICE_TIER_LABELS[0] };
  }

  const score = computeCapabilityScore(input);
  const uncappedTier = scoreToUncappedTier(score);
  const cap = FORM_FACTOR_TIER_CAP[input.formFactor ?? "unknown"];
  const fallbackCap: DeviceTier | null = input.fallbackAdapter ? 1 : null;
  const effectiveCap = fallbackCap === null ? cap : cap === null ? fallbackCap : Math.min(cap, fallbackCap);
  const cappedTier = (effectiveCap === null ? uncappedTier : Math.min(uncappedTier, effectiveCap)) as DeviceTier;

  const promotedTier = applyMeasuredPromotion(cappedTier, uncappedTier, input);
  const finalTier = applyStabilityDemotion(promotedTier, input);

  return { tier: finalTier, label: DEVICE_TIER_LABELS[finalTier] };
}

export function getCapabilityClass(deviceTier: DeviceTier): CapabilityClass {
  if (deviceTier === 0) return "compatibility";
  if (deviceTier === 1) return "light";
  if (deviceTier === 2) return "balanced";
  return "performance";
}

import type { DeviceTier, PerformanceMode } from "@free-ai-open/types";

export function recommendPerformanceMode(deviceTier: DeviceTier): PerformanceMode {
  if (deviceTier <= 1) return "fast";
  if (deviceTier <= 3) return "balanced";
  return "performance";
}

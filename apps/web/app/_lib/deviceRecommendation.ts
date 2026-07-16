import type { DeviceTier, PerformanceMode } from "@free-ai-open/types";

export function recommendPerformanceMode(deviceTier: DeviceTier): PerformanceMode {
  if (deviceTier <= 1) return "fast";
  if (deviceTier <= 3) return "balanced";
  return "performance";
}

export type DeviceCapabilityLevel = "limited" | "lightweight" | "recommended" | "highPerformance";

// Plain-language capability category for the normal (non-technical) UI.
// Boundaries intentionally mirror recommendPerformanceMode so the label a
// user sees always matches the mode the app actually picks for them; the
// raw numeric tier stays available separately for advanced details/debug.
export function describeDeviceCapability(webgpuAvailable: boolean, deviceTier: DeviceTier): DeviceCapabilityLevel {
  if (!webgpuAvailable) return "limited";
  if (deviceTier <= 1) return "lightweight";
  if (deviceTier <= 3) return "recommended";
  return "highPerformance";
}

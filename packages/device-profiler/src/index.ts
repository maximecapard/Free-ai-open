import type { Backend, DeviceTier } from "@free-ai-open/types";

export interface DeviceProfile {
  webgpuAvailable: boolean;
  wasmAvailable: boolean;
  preferredBackend: Backend;
  estimatedMemoryGb?: number;
  storageQuotaGb?: number;
  browserFamily: string;
  osFamily: string;
  deviceTier: DeviceTier;
}

export async function detectDeviceProfile(): Promise<DeviceProfile> {
  const nav = globalThis.navigator;
  const webgpuAvailable = typeof nav !== "undefined" && "gpu" in nav;
  const estimatedMemoryGb = typeof nav !== "undefined" ? (nav as Navigator & { deviceMemory?: number }).deviceMemory : undefined;

  const deviceTier: DeviceTier = webgpuAvailable
    ? estimatedMemoryGb && estimatedMemoryGb >= 16
      ? 3
      : estimatedMemoryGb && estimatedMemoryGb >= 8
        ? 2
        : 1
    : 0;

  return {
    webgpuAvailable,
    wasmAvailable: typeof WebAssembly !== "undefined",
    preferredBackend: webgpuAvailable ? "webgpu" : "wasm",
    estimatedMemoryGb,
    browserFamily: "unknown",
    osFamily: "unknown",
    deviceTier,
  };
}

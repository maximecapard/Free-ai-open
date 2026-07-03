import type { Backend, DeviceTier } from "@free-ai-open/types";
import { detectBrowserInfo } from "./families";
import type {
  DeviceProfile,
  DeviceProfilerEnvironment,
  DeviceTierInfo,
  DeviceTierInput,
  DeviceTierLabel,
  LightweightBenchmarkResult,
  NavigatorLike,
} from "./types";

const BYTES_PER_GB = 1024 ** 3;
const DEVICE_TIER_LABELS: Record<DeviceTier, DeviceTierLabel> = {
  0: "cpu_only",
  1: "webgpu_low",
  2: "webgpu_medium",
  3: "webgpu_high",
  4: "desktop_power",
};

function readGlobalNavigator(): NavigatorLike | undefined {
  const maybeNavigator = globalThis as typeof globalThis & { navigator?: NavigatorLike };
  return maybeNavigator.navigator;
}

function readWebAssemblyAvailability(): boolean {
  return typeof WebAssembly !== "undefined";
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function bytesToRoundedGb(value: number | undefined): number | undefined {
  const normalized = normalizePositiveNumber(value);
  if (normalized === undefined) return undefined;
  return Math.round((normalized / BYTES_PER_GB) * 10) / 10;
}

export async function detectWebGPUAvailability(navigatorLike = readGlobalNavigator()): Promise<boolean> {
  const gpu = navigatorLike?.gpu;
  const requestAdapter = gpu?.requestAdapter;
  if (typeof requestAdapter !== "function") {
    return false;
  }

  try {
    const adapter = await requestAdapter.call(gpu);
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

export function estimateDeviceMemory(navigatorLike = readGlobalNavigator()): number | undefined {
  return normalizePositiveNumber(navigatorLike?.deviceMemory);
}

export async function estimateStorageQuota(navigatorLike = readGlobalNavigator()): Promise<number | undefined> {
  const storage = navigatorLike?.storage;
  const estimate = storage?.estimate;
  if (typeof estimate !== "function") {
    return undefined;
  }

  try {
    const result = await estimate.call(storage);
    return bytesToRoundedGb(result.quota);
  } catch {
    return undefined;
  }
}

export function runLightweightBenchmark(): LightweightBenchmarkResult {
  return {
    status: "skipped",
    score: null,
    reason: "placeholder",
  };
}

export function getDeviceTier(input: DeviceTierInput): DeviceTierInfo {
  if (!input.webgpuAvailable) {
    return { tier: 0, label: DEVICE_TIER_LABELS[0] };
  }

  const memoryGb = input.estimatedMemoryGb ?? 0;
  const storageGb = input.storageQuotaGb ?? 0;

  if (memoryGb >= 16 && storageGb >= 16) {
    return { tier: 4, label: DEVICE_TIER_LABELS[4] };
  }
  if (memoryGb >= 8) {
    return { tier: 3, label: DEVICE_TIER_LABELS[3] };
  }
  if (memoryGb >= 4) {
    return { tier: 2, label: DEVICE_TIER_LABELS[2] };
  }
  return { tier: 1, label: DEVICE_TIER_LABELS[1] };
}

export async function buildDeviceProfile(environment: DeviceProfilerEnvironment = {}): Promise<DeviceProfile> {
  const navigatorLike = environment.navigator;
  const wasmAvailable = environment.webAssemblyAvailable ?? readWebAssemblyAvailability();
  const [webgpuAvailable, storageQuotaGb] = await Promise.all([
    detectWebGPUAvailability(navigatorLike),
    estimateStorageQuota(navigatorLike),
  ]);
  const estimatedMemoryGb = estimateDeviceMemory(navigatorLike);
  const deviceTierInfo = getDeviceTier({
    webgpuAvailable,
    wasmAvailable,
    estimatedMemoryGb,
    storageQuotaGb,
  });
  const preferredBackend: Backend = webgpuAvailable ? "webgpu" : wasmAvailable ? "wasm" : "cpu";
  const browserInfo = detectBrowserInfo(navigatorLike);

  return {
    webgpuAvailable,
    wasmAvailable,
    preferredBackend,
    estimatedMemoryGb,
    storageQuotaGb,
    ...browserInfo,
    benchmark: runLightweightBenchmark(),
    deviceTier: deviceTierInfo.tier,
    deviceTierLabel: deviceTierInfo.label,
  };
}

export async function detectDeviceProfile(): Promise<DeviceProfile> {
  return buildDeviceProfile({
    navigator: readGlobalNavigator(),
    webAssemblyAvailable: readWebAssemblyAvailability(),
  });
}

import type { Backend } from "@free-ai-open/types";
import { classifyCpuConcurrency, classifyMemory, detectCpuConcurrency } from "./capabilities";
import { detectBrowserInfo } from "./families";
import { buildStaticCapabilityProfile } from "./static-profile";
import { getCapabilityClass, getDeviceTier } from "./scoring";
import type { DeviceProfile, DeviceProfilerEnvironment, LightweightBenchmarkResult, NavigatorLike } from "./types";

const BYTES_PER_GB = 1024 ** 3;

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

export async function buildDeviceProfile(environment: DeviceProfilerEnvironment = {}): Promise<DeviceProfile> {
  const navigatorLike = environment.navigator;
  const wasmAvailable = environment.webAssemblyAvailable ?? readWebAssemblyAvailability();
  const [staticCapabilityProfile, storageQuotaGb] = await Promise.all([
    buildStaticCapabilityProfile({ ...environment, navigator: navigatorLike, webAssemblyAvailable: wasmAvailable }),
    estimateStorageQuota(navigatorLike),
  ]);
  const webgpuAvailable = staticCapabilityProfile.webgpuAvailable;
  const estimatedMemoryGb = estimateDeviceMemory(navigatorLike);
  const cpuConcurrency = detectCpuConcurrency(navigatorLike);
  const formFactor = staticCapabilityProfile.formFactor;
  const architectureClass = staticCapabilityProfile.architectureClass;
  const measuredPerformance = environment.measuredPerformance;
  const deviceTierInfo = getDeviceTier({
    webgpuAvailable,
    wasmAvailable,
    estimatedMemoryGb,
    storageQuotaGb,
    formFactor,
    cpuConcurrency,
    fallbackAdapter: staticCapabilityProfile.fallbackAdapter,
    gpuFeatureClasses: staticCapabilityProfile.gpu.featureClasses,
    gpuLimitClasses: staticCapabilityProfile.gpu.limitClasses,
    experimentalMemoryClass: staticCapabilityProfile.gpu.experimentalMemoryClass,
    measuredPerformance,
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
    formFactor,
    architectureClass,
    memoryClass: classifyMemory(estimatedMemoryGb),
    cpuConcurrencyClass: classifyCpuConcurrency(cpuConcurrency),
    capabilityClass: getCapabilityClass(deviceTierInfo.tier),
    staticCapabilityProfile,
    ...(measuredPerformance ? { measuredPerformance } : {}),
  };
}

export async function detectDeviceProfile(): Promise<DeviceProfile> {
  return buildDeviceProfile({
    navigator: readGlobalNavigator(),
    webAssemblyAvailable: readWebAssemblyAvailability(),
  });
}

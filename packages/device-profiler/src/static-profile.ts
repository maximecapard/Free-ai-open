import type { CapabilityConfidence, StaticCapabilityProfile } from "@free-ai-open/types";
import {
  classifyCpuConcurrency,
  classifyMemory,
  coarsenApproximateMemoryGb,
  coarsenCpuConcurrency,
  detectArchitectureClass,
  detectCpuConcurrency,
  detectFormFactor,
} from "./capabilities";
import { detectBrowserInfo } from "./families";
import { normalizeGpuProfile, readAdapterInfo, requestWebGpuAdapter } from "./gpu";
import { getCapabilityClass, getDeviceTier } from "./scoring";
import type { DeviceProfilerEnvironment, NavigatorLike } from "./types";

export const STATIC_CAPABILITY_PROFILE_SCHEMA_VERSION = 2;
export const STATIC_CAPABILITY_PROFILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readGlobalNavigator(): NavigatorLike | undefined {
  const maybeNavigator = globalThis as typeof globalThis & { navigator?: NavigatorLike };
  return maybeNavigator.navigator;
}

function readWebAssemblyAvailability(): boolean {
  return typeof WebAssembly !== "undefined";
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function inferConfidence(profile: Omit<StaticCapabilityProfile, "confidence">): CapabilityConfidence {
  let signalCount = 0;
  if (profile.formFactor !== "unknown") signalCount += 1;
  if (profile.architectureClass !== "unknown") signalCount += 1;
  if (profile.memoryClass !== "unknown") signalCount += 1;
  if (profile.logicalProcessorClass !== "unknown") signalCount += 1;
  if (profile.webgpuAvailable) signalCount += 1;
  if (profile.gpu.vendorClass && profile.gpu.vendorClass !== "unknown") signalCount += 1;
  if (Object.keys(profile.gpu.limitClasses).length > 0) signalCount += 1;

  if (profile.fallbackAdapter) return "low";
  if (signalCount >= 6) return "high";
  if (signalCount >= 3) return "medium";
  return "low";
}

export interface StaticCapabilityProfileOptions {
  now?: () => Date;
  maxAgeMs?: number;
}

export async function buildStaticCapabilityProfile(
  environment: DeviceProfilerEnvironment = {},
  options: StaticCapabilityProfileOptions = {}
): Promise<StaticCapabilityProfile> {
  const hasNavigatorOverride = Object.prototype.hasOwnProperty.call(environment, "navigator");
  const navigatorLike = hasNavigatorOverride ? environment.navigator : readGlobalNavigator();
  const wasmAvailable = environment.webAssemblyAvailable ?? readWebAssemblyAvailability();
  const now = (options.now ?? (() => new Date()))();
  const detectedAt = now.toISOString();
  const expiresAt = addMs(now, options.maxAgeMs ?? STATIC_CAPABILITY_PROFILE_MAX_AGE_MS).toISOString();
  const adapter = await requestWebGpuAdapter(navigatorLike);
  const adapterInfo = await readAdapterInfo(adapter);
  const gpu = normalizeGpuProfile(adapter, adapterInfo);
  const webgpuAvailable = adapter !== null;
  const estimatedMemoryGb = coarsenApproximateMemoryGb(
    typeof navigatorLike?.deviceMemory === "number" && Number.isFinite(navigatorLike.deviceMemory) && navigatorLike.deviceMemory > 0
      ? navigatorLike.deviceMemory
      : undefined
  );
  const cpuConcurrency = coarsenCpuConcurrency(detectCpuConcurrency(navigatorLike));
  const browserInfo = detectBrowserInfo(navigatorLike);
  const formFactor = detectFormFactor(navigatorLike);
  const architectureClass = await detectArchitectureClass(navigatorLike);
  const tierInfo = getDeviceTier({
    webgpuAvailable,
    wasmAvailable,
    estimatedMemoryGb,
    formFactor,
    cpuConcurrency,
    fallbackAdapter: gpu.fallbackAdapter,
    gpuFeatureClasses: gpu.featureClasses,
    gpuLimitClasses: gpu.limitClasses,
    experimentalMemoryClass: gpu.experimentalMemoryClass,
    measuredPerformance: environment.measuredPerformance,
  });

  const withoutConfidence: Omit<StaticCapabilityProfile, "confidence"> = {
    schemaVersion: STATIC_CAPABILITY_PROFILE_SCHEMA_VERSION,
    detectedAt,
    expiresAt,
    formFactor,
    architectureClass,
    browserFamily: browserInfo.browserFamily,
    osFamily: browserInfo.osFamily,
    memoryClass: classifyMemory(estimatedMemoryGb),
    logicalProcessorClass: classifyCpuConcurrency(cpuConcurrency),
    ...(estimatedMemoryGb !== undefined ? { approximateMemoryGB: estimatedMemoryGb } : {}),
    ...(cpuConcurrency !== undefined ? { logicalProcessors: cpuConcurrency } : {}),
    webgpuAvailable,
    wasmAvailable,
    ...(gpu.fallbackAdapter !== undefined ? { fallbackAdapter: gpu.fallbackAdapter } : {}),
    capabilityClass: getCapabilityClass(tierInfo.tier),
    deviceTier: tierInfo.tier,
    gpu: {
      vendorClass: gpu.vendorClass,
      architectureClass: gpu.architectureClass,
      descriptionClass: gpu.descriptionClass,
      featureClasses: gpu.featureClasses,
      limitClasses: gpu.limitClasses,
      ...(gpu.experimentalMemoryClass
        ? {
            experimentalMemoryClass: gpu.experimentalMemoryClass,
            experimentalMemoryConfidence: "low" as const,
          }
        : {}),
    },
  };

  return {
    ...withoutConfidence,
    confidence: inferConfidence(withoutConfidence),
  };
}

export async function detectStaticCapabilityProfile(
  options: StaticCapabilityProfileOptions = {}
): Promise<StaticCapabilityProfile> {
  return buildStaticCapabilityProfile(
    {
      navigator: readGlobalNavigator(),
      webAssemblyAvailable: readWebAssemblyAvailability(),
    },
    options
  );
}

export const browserFamilies = ["chromium", "chrome", "edge", "firefox", "safari", "unknown"] as const;
export type BrowserFamily = (typeof browserFamilies)[number];

export const osFamilies = ["windows", "android", "ios", "macos", "linux", "unknown"] as const;
export type OsFamily = (typeof osFamilies)[number];

export const gpuVendorClasses = ["nvidia", "amd", "intel", "apple", "qualcomm", "arm", "unknown"] as const;

export const gpuArchitectureClasses = [
  "apple",
  "adreno",
  "mali",
  "nvidia-modern",
  "nvidia-legacy",
  "amd-rdna",
  "amd-legacy",
  "intel-xe",
  "intel-legacy",
  "unknown",
] as const;

export const gpuDescriptionClasses = ["integrated", "discrete", "software", "unknown"] as const;

export const gpuFeatureClasses = [
  "shader-f16",
  "timestamp-query",
  "texture-compression-bc",
  "texture-compression-etc2",
  "texture-compression-astc",
  "subgroups",
  "storage-textures",
  "unknown",
] as const;
export type GpuFeatureClass = (typeof gpuFeatureClasses)[number];

export const gpuLimitKeys = [
  "maxBufferSize",
  "maxStorageBufferBindingSize",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxBindGroups",
  "maxBindingsPerBindGroup",
  "maxStorageBuffersPerShaderStage",
] as const;
export type GpuLimitKey = (typeof gpuLimitKeys)[number];

export const gpuLimitClasses = ["low", "medium", "high", "very_high", "unknown"] as const;

export const experimentalMemoryClasses = [
  "lt_1gb",
  "1_to_2gb",
  "2_to_4gb",
  "4_to_8gb",
  "8gb_plus",
  "unknown",
] as const;

export function buildCapabilityProfileKey(profile: {
  formFactor: string;
  capabilityClass: string;
  webgpuAvailable: boolean;
  fallbackAdapter?: boolean;
}): string {
  return [
    profile.formFactor,
    profile.capabilityClass,
    profile.webgpuAvailable ? "webgpu" : "no-webgpu",
    profile.fallbackAdapter ? "fallback" : "native",
  ].join(":");
}

import type {
  ExperimentalMemoryClass,
  GpuAdapterLike,
  GpuArchitectureClass,
  GpuDescriptionClass,
  GpuFeatureClass,
  GpuInfoLike,
  GpuLimitClass,
  GpuVendorClass,
  NavigatorLike,
  NormalizedGpuProfile,
} from "./types";

const SELECTED_LIMIT_KEYS = [
  "maxBufferSize",
  "maxStorageBufferBindingSize",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxBindGroups",
  "maxBindingsPerBindGroup",
  "maxStorageBuffersPerShaderStage",
] as const;

const FEATURE_ALIASES: Record<string, GpuFeatureClass> = {
  "shader-f16": "shader-f16",
  "timestamp-query": "timestamp-query",
  "texture-compression-bc": "texture-compression-bc",
  "texture-compression-etc2": "texture-compression-etc2",
  "texture-compression-astc": "texture-compression-astc",
  subgroups: "subgroups",
  "readonly-and-readwrite-storage-textures": "storage-textures",
  "readonly_and_readwrite_storage_textures": "storage-textures",
};

const BYTES_PER_GB = 1024 ** 3;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function lower(value: unknown): string {
  return asString(value)?.toLowerCase() ?? "";
}

function joinedGpuText(info: GpuInfoLike | undefined): string {
  return [info?.vendor, info?.architecture, info?.device, info?.description]
    .map((value) => lower(value))
    .filter(Boolean)
    .join(" ");
}

export async function requestWebGpuAdapter(navigatorLike: NavigatorLike | undefined): Promise<GpuAdapterLike | null> {
  const gpu = navigatorLike?.gpu;
  const requestAdapter = gpu?.requestAdapter;
  if (typeof requestAdapter !== "function") return null;

  try {
    const adapter = await requestAdapter.call(gpu);
    return asRecord(adapter) ? (adapter as GpuAdapterLike) : null;
  } catch {
    return null;
  }
}

export async function readAdapterInfo(adapter: GpuAdapterLike | null): Promise<GpuInfoLike | undefined> {
  if (!adapter) return undefined;
  if (adapter.info && typeof adapter.info === "object") return adapter.info;

  const requestAdapterInfo = adapter.requestAdapterInfo;
  if (typeof requestAdapterInfo !== "function") return undefined;

  try {
    const info = await requestAdapterInfo.call(adapter);
    return asRecord(info) ? (info as GpuInfoLike) : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeGpuVendorClass(info: GpuInfoLike | undefined): GpuVendorClass {
  const text = joinedGpuText(info);
  if (text.includes("nvidia") || text.includes("geforce") || text.includes("rtx") || text.includes("0x10de")) return "nvidia";
  if (text.includes("amd") || text.includes("radeon") || text.includes("0x1002")) return "amd";
  if (text.includes("intel") || text.includes("0x8086")) return "intel";
  if (text.includes("apple")) return "apple";
  if (text.includes("qualcomm") || text.includes("adreno")) return "qualcomm";
  if (text.includes("arm") || text.includes("mali")) return "arm";
  return "unknown";
}

export function normalizeGpuArchitectureClass(info: GpuInfoLike | undefined): GpuArchitectureClass {
  const text = joinedGpuText(info);
  if (text.includes("apple")) return "apple";
  if (text.includes("adreno")) return "adreno";
  if (text.includes("mali")) return "mali";
  if (text.includes("ada") || text.includes("ampere") || text.includes("turing") || text.includes("rtx")) {
    return "nvidia-modern";
  }
  if (text.includes("pascal") || text.includes("maxwell") || text.includes("geforce")) return "nvidia-legacy";
  if (text.includes("rdna") || text.includes("rx 7") || text.includes("rx 6")) return "amd-rdna";
  if (text.includes("radeon") || text.includes("amd")) return "amd-legacy";
  if (text.includes("xe") || text.includes("arc")) return "intel-xe";
  if (text.includes("intel")) return "intel-legacy";
  return "unknown";
}

export function detectFallbackAdapter(adapter: GpuAdapterLike | null, info: GpuInfoLike | undefined): boolean | undefined {
  if (!adapter) return undefined;
  if (typeof adapter.isFallbackAdapter === "boolean") return adapter.isFallbackAdapter;
  const text = joinedGpuText(info);
  if (text.includes("swiftshader") || text.includes("llvmpipe") || text.includes("software") || text.includes("fallback")) {
    return true;
  }
  return undefined;
}

export function normalizeGpuDescriptionClass(
  vendorClass: GpuVendorClass,
  fallbackAdapter: boolean | undefined
): GpuDescriptionClass {
  if (fallbackAdapter) return "software";
  if (vendorClass === "nvidia" || vendorClass === "amd") return "discrete";
  if (vendorClass === "intel" || vendorClass === "apple" || vendorClass === "qualcomm" || vendorClass === "arm") {
    return "integrated";
  }
  return "unknown";
}

function collectIterableValues(value: GpuAdapterLike["features"]): unknown[] {
  if (!value) return [];
  if (typeof (value as Iterable<unknown>)[Symbol.iterator] === "function") {
    return Array.from(value as Iterable<unknown>);
  }

  const results: unknown[] = [];
  const forEach = (value as { forEach?: (callback: (item: unknown) => void) => void }).forEach;
  if (typeof forEach === "function") {
    forEach.call(value, (item: unknown) => results.push(item));
  }
  return results;
}

export function normalizeGpuFeatureClasses(features: GpuAdapterLike["features"]): GpuFeatureClass[] {
  const normalized = new Set<GpuFeatureClass>();
  for (const value of collectIterableValues(features)) {
    const key = lower(value).replaceAll("_", "-");
    const featureClass = FEATURE_ALIASES[key];
    if (featureClass) normalized.add(featureClass);
  }
  return Array.from(normalized).sort();
}

function bucketByteLimit(value: number): GpuLimitClass {
  if (value < 128 * 1024 ** 2) return "low";
  if (value < 512 * 1024 ** 2) return "medium";
  if (value < 1024 ** 3) return "high";
  return "very_high";
}

function bucketWorkgroupStorageLimit(value: number): GpuLimitClass {
  if (value < 16 * 1024) return "low";
  if (value < 32 * 1024) return "medium";
  return "high";
}

function bucketInvocationsLimit(value: number): GpuLimitClass {
  if (value < 128) return "low";
  if (value < 256) return "medium";
  return "high";
}

function bucketSmallCountLimit(value: number): GpuLimitClass {
  if (value < 4) return "low";
  if (value === 4) return "medium";
  return "high";
}

function bucketGenericLimit(key: string, value: number): GpuLimitClass {
  if (key === "maxBufferSize" || key === "maxStorageBufferBindingSize") return bucketByteLimit(value);
  if (key === "maxComputeWorkgroupStorageSize") return bucketWorkgroupStorageLimit(value);
  if (key === "maxComputeInvocationsPerWorkgroup") return bucketInvocationsLimit(value);
  if (key === "maxBindGroups" || key === "maxBindingsPerBindGroup" || key === "maxStorageBuffersPerShaderStage") {
    return bucketSmallCountLimit(value);
  }
  return "unknown";
}

export function normalizeGpuLimitClasses(limits: GpuAdapterLike["limits"]): Record<string, GpuLimitClass> {
  const normalized: Record<string, GpuLimitClass> = {};
  const source = asRecord(limits);
  if (!source) return normalized;

  for (const key of SELECTED_LIMIT_KEYS) {
    const value = asFiniteNumber(source[key]);
    if (value !== undefined) {
      normalized[key] = bucketGenericLimit(key, value);
    }
  }
  return normalized;
}

function readHeapByteValues(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap(readHeapByteValues);
  }

  const record = asRecord(value);
  if (!record) {
    const numberValue = asFiniteNumber(value);
    return numberValue === undefined ? [] : [numberValue];
  }

  const direct = asFiniteNumber(record.size) ?? asFiniteNumber(record.bytes) ?? asFiniteNumber(record.memorySize);
  const values = direct === undefined ? [] : [direct];
  const nestedHeaps = Array.isArray(record.memoryHeaps) ? record.memoryHeaps.flatMap(readHeapByteValues) : [];
  return [...values, ...nestedHeaps];
}

function readExperimentalMemoryBytes(info: GpuInfoLike | undefined, adapter: GpuAdapterLike | null): number | undefined {
  const candidates = [
    info?.memoryHeaps,
    info?.memoryHeapSize,
    info?.memorySize,
    adapter?.memoryInfo,
  ].flatMap(readHeapByteValues);
  return candidates.length === 0 ? undefined : Math.max(...candidates);
}

export function classifyExperimentalMemory(value: number | undefined): ExperimentalMemoryClass | undefined {
  if (value === undefined) return undefined;
  const gb = value / BYTES_PER_GB;
  if (gb < 1) return "lt_1gb";
  if (gb < 2) return "1_to_2gb";
  if (gb < 4) return "2_to_4gb";
  if (gb < 8) return "4_to_8gb";
  return "8gb_plus";
}

export function normalizeGpuProfile(adapter: GpuAdapterLike | null, info: GpuInfoLike | undefined): NormalizedGpuProfile {
  const vendorClass = normalizeGpuVendorClass(info);
  const architectureClass = normalizeGpuArchitectureClass(info);
  const fallbackAdapter = detectFallbackAdapter(adapter, info);
  const descriptionClass = normalizeGpuDescriptionClass(vendorClass, fallbackAdapter);
  const experimentalMemoryClass = classifyExperimentalMemory(readExperimentalMemoryBytes(info, adapter));

  return {
    vendorClass,
    architectureClass,
    descriptionClass,
    featureClasses: normalizeGpuFeatureClasses(adapter?.features),
    limitClasses: normalizeGpuLimitClasses(adapter?.limits),
    ...(fallbackAdapter !== undefined ? { fallbackAdapter } : {}),
    ...(experimentalMemoryClass ? { experimentalMemoryClass, experimentalMemoryConfidence: "low" as const } : {}),
  };
}

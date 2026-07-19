export { taskCategories } from "./core";
export type { Backend, DeviceTier, PerformanceMode, TaskCategory } from "./core";
export {
  buildCapabilityProfileKey,
  browserFamilies,
  experimentalMemoryClasses,
  gpuArchitectureClasses,
  gpuDescriptionClasses,
  gpuFeatureClasses,
  gpuLimitClasses,
  gpuLimitKeys,
  gpuVendorClasses,
  osFamilies,
} from "./capability-values";
export type { BrowserFamily, GpuFeatureClass, GpuLimitKey, OsFamily } from "./capability-values";
export type {
  ArchitectureClass,
  CapabilityClass,
  CapabilityConfidence,
  ExperimentalMemoryClass,
  FormFactor,
  GpuArchitectureClass,
  GpuDescriptionClass,
  GpuLimitClass,
  GpuVendorClass,
  LocalBenchmarkResult,
  LocalBenchmarkErrorCode,
  LocalBenchmarkResponsiveness,
  LocalBenchmarkStage,
  LocalBenchmarkStability,
  LocalBenchmarkStatus,
  LocalBenchmarkTimingMethod,
  LogicalProcessorClass,
  MemoryClass,
  ModelPerformanceObservation,
  StaticCapabilityProfile,
} from "./router-signals";

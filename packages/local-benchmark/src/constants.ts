export const LOCAL_BENCHMARK_SCHEMA_VERSION = 2;
export const LOCAL_BENCHMARK_VERSION = "1.0.0";
export const LOCAL_BENCHMARK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const LOCAL_BENCHMARK_TIMEOUT_MS = 5_000;

export const DESKTOP_WORKLOAD = {
  elementCount: 32_768,
  iterations: 256,
  warmupCount: 1,
  sampleCount: 5,
} as const;

export const REDUCED_WORKLOAD = {
  elementCount: 8_192,
  iterations: 128,
  warmupCount: 1,
  sampleCount: 3,
} as const;

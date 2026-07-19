import type {
  FormFactor,
  LocalBenchmarkResponsiveness,
  LocalBenchmarkStability,
} from "@free-ai-open/types";
export { buildCapabilityProfileKey } from "@free-ai-open/types";
import { DESKTOP_WORKLOAD, REDUCED_WORKLOAD } from "./constants";
import type { BenchmarkWorkloadConfig } from "./types";

export function workloadForFormFactor(formFactor: FormFactor): BenchmarkWorkloadConfig {
  return formFactor === "desktop" ? { ...DESKTOP_WORKLOAD } : { ...REDUCED_WORKLOAD };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function computeNormalizedScore(medianMs: number, config: BenchmarkWorkloadConfig): number {
  if (!Number.isFinite(medianMs) || medianMs <= 0) return 0;
  const operations = config.elementCount * config.iterations;
  const desktopReferenceOperations = DESKTOP_WORKLOAD.elementCount * DESKTOP_WORKLOAD.iterations;
  const normalizedMs = medianMs * (desktopReferenceOperations / operations);
  return Math.round(Math.max(0, Math.min(100, 100 / (1 + normalizedMs / 20))));
}

export function classifyStability(samples: readonly number[]): LocalBenchmarkStability {
  if (samples.length < 2 || samples.some((sample) => !Number.isFinite(sample) || sample <= 0)) return "failed";
  const middle = median(samples);
  const spread = (Math.max(...samples) - Math.min(...samples)) / middle;
  return spread <= 0.35 ? "stable" : "degraded";
}

export function classifyResponsiveness(delayMs: number): LocalBenchmarkResponsiveness {
  if (!Number.isFinite(delayMs) || delayMs < 0) return "unknown";
  if (delayMs <= 100) return "responsive";
  if (delayMs <= 300) return "degraded";
  return "poor";
}

import type { LocalBenchmarkErrorCode, LocalBenchmarkResult } from "@free-ai-open/types";
import {
  LOCAL_BENCHMARK_MAX_AGE_MS,
  LOCAL_BENCHMARK_SCHEMA_VERSION,
  LOCAL_BENCHMARK_TIMEOUT_MS,
  LOCAL_BENCHMARK_VERSION,
} from "./constants";
import {
  buildCapabilityProfileKey,
  classifyResponsiveness,
  classifyStability,
  computeNormalizedScore,
  median,
  workloadForFormFactor,
} from "./scoring";
import type { RunLocalBenchmarkOptions } from "./types";

function failedResult(
  options: RunLocalBenchmarkOptions,
  measuredAt: Date,
  startedAt: number,
  errorCode: LocalBenchmarkErrorCode,
  status: LocalBenchmarkResult["status"] = "failed"
): LocalBenchmarkResult {
  return {
    schemaVersion: LOCAL_BENCHMARK_SCHEMA_VERSION,
    benchmarkVersion: LOCAL_BENCHMARK_VERSION,
    capabilityProfileKey: buildCapabilityProfileKey(options.profile),
    measuredAt: measuredAt.toISOString(),
    expiresAt: new Date(measuredAt.getTime() + LOCAL_BENCHMARK_MAX_AGE_MS).toISOString(),
    status,
    stage: "initialization",
    durationMs: Math.max(0, (options.performanceNow ?? performance.now.bind(performance))() - startedAt),
    responsiveness: "unknown",
    stability: status === "cancelled" ? "unknown" : "failed",
    confidence: "low",
    errorCode,
  };
}

export async function runLocalBenchmark(options: RunLocalBenchmarkOptions): Promise<LocalBenchmarkResult> {
  const now = options.now ?? (() => new Date());
  const performanceNow = options.performanceNow ?? performance.now.bind(performance);
  const setTimer = options.setTimeoutFn ?? setTimeout;
  const clearTimer = options.clearTimeoutFn ?? clearTimeout;
  const measuredAt = now();
  const startedAt = performanceNow();

  if (!options.profile.webgpuAvailable) {
    return failedResult(options, measuredAt, startedAt, "webgpu_unavailable", "unsupported");
  }
  if (options.signal?.aborted) return failedResult(options, measuredAt, startedAt, "cancelled", "cancelled");

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });

  const responsivenessStartedAt = performanceNow();
  let responsivenessDelay = 0;
  const responsivenessTimer = setTimer(() => {
    responsivenessDelay = Math.max(0, performanceNow() - responsivenessStartedAt);
  }, 0);

  const timeoutMs = options.timeoutMs ?? LOCAL_BENCHMARK_TIMEOUT_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimer(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const config = workloadForFormFactor(options.profile.formFactor);
    const outcome = await Promise.race([options.executeWorkload(config, controller.signal), timeout]);
    if (outcome === "timeout") return failedResult(options, measuredAt, startedAt, "timeout");
    if (options.signal?.aborted) return failedResult(options, measuredAt, startedAt, "cancelled", "cancelled");
    if (!outcome.ok) return failedResult(options, measuredAt, startedAt, outcome.error.errorCode);

    const samples = outcome.value.samplesMs.filter((sample) => Number.isFinite(sample) && sample > 0);
    if (samples.length !== config.sampleCount) {
      return failedResult(options, measuredAt, startedAt, "invalid_compute_result");
    }
    const medianComputeMs = median(samples);
    const stability = classifyStability(samples);
    const responsiveness = classifyResponsiveness(responsivenessDelay);
    return {
      schemaVersion: LOCAL_BENCHMARK_SCHEMA_VERSION,
      benchmarkVersion: LOCAL_BENCHMARK_VERSION,
      capabilityProfileKey: buildCapabilityProfileKey(options.profile),
      measuredAt: measuredAt.toISOString(),
      expiresAt: new Date(measuredAt.getTime() + LOCAL_BENCHMARK_MAX_AGE_MS).toISOString(),
      status: "completed",
      stage: "complete",
      webgpuInitMs: Math.max(0, outcome.value.initMs),
      computeScore: computeNormalizedScore(medianComputeMs, config),
      medianComputeMs,
      sampleCount: samples.length,
      mainThreadDelayMs: responsivenessDelay,
      durationMs: Math.max(0, performanceNow() - startedAt),
      timingMethod: outcome.value.timingMethod,
      responsiveness,
      stability,
      confidence: stability === "stable" && responsiveness !== "poor" ? "medium" : "low",
    };
  } catch {
    const errorCode = options.signal?.aborted ? "cancelled" : "worker_failed";
    return failedResult(options, measuredAt, startedAt, errorCode, errorCode === "cancelled" ? "cancelled" : "failed");
  } finally {
    clearTimer(responsivenessTimer);
    if (timeoutHandle !== undefined) clearTimer(timeoutHandle);
    options.signal?.removeEventListener("abort", abort);
  }
}

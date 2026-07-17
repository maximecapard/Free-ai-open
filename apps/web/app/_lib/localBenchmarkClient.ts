import { runLocalBenchmark } from "@free-ai-open/local-benchmark";
import type { BenchmarkWorkloadConfig, BenchmarkWorkloadOutcome } from "@free-ai-open/local-benchmark";
import type { LocalBenchmarkResult, StaticCapabilityProfile } from "@free-ai-open/types";
import { addLocalLog } from "@free-ai-open/local-logs";
import { getStoredLocalBenchmarkForProfile, setStoredLocalBenchmarkResult } from "./benchmarkResultStore";

interface WorkerReply {
  id: string;
  outcome: BenchmarkWorkloadOutcome;
}

function executeInWorker(config: BenchmarkWorkloadConfig, signal: AbortSignal): Promise<BenchmarkWorkloadOutcome> {
  return new Promise((resolve) => {
    if (typeof Worker === "undefined") {
      resolve({ ok: false, error: { errorCode: "worker_failed" } });
      return;
    }
    const worker = new Worker(new URL("../../workers/local-benchmark.worker.ts", import.meta.url), { type: "module" });
    const id = crypto.randomUUID();
    let settled = false;
    const finish = (outcome: BenchmarkWorkloadOutcome) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      signal.removeEventListener("abort", abort);
      document.removeEventListener("visibilitychange", visibilityChanged);
      resolve(outcome);
    };
    const abort = () => finish({ ok: false, error: { errorCode: "cancelled" } });
    const visibilityChanged = () => {
      if (document.hidden) finish({ ok: false, error: { errorCode: "background_throttled" } });
    };
    signal.addEventListener("abort", abort, { once: true });
    document.addEventListener("visibilitychange", visibilityChanged);
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (event.data.id === id) finish(event.data.outcome);
    };
    worker.onerror = () => finish({ ok: false, error: { errorCode: "worker_failed" } });
    worker.postMessage({ id, config });
  });
}

async function logResult(result: LocalBenchmarkResult): Promise<void> {
  const event = result.status === "completed" ? "benchmark.completed" : result.status === "cancelled" ? "benchmark.cancelled" : "benchmark.failed";
  await addLocalLog({
    event,
    severity: result.status === "completed" ? "info" : result.status === "cancelled" ? "debug" : "warn",
    errorCode: result.errorCode,
    performanceMetrics: result.durationMs === undefined ? undefined : { totalTimeMs: result.durationMs },
  });
}

export async function runAndStoreLocalBenchmark(
  profile: StaticCapabilityProfile,
  options: { force?: boolean; signal?: AbortSignal } = {}
): Promise<{ result: LocalBenchmarkResult; source: "cache" | "measurement" }> {
  const cached = getStoredLocalBenchmarkForProfile(profile);
  if (cached && !options.force) return { result: cached, source: "cache" };

  await addLocalLog({ event: "benchmark.started", severity: "info" });
  const result = await runLocalBenchmark({ profile, executeWorkload: executeInWorker, signal: options.signal });
  if (result.status !== "cancelled") setStoredLocalBenchmarkResult(result);
  await logResult(result);
  return { result, source: "measurement" };
}

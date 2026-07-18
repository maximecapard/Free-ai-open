import type { InferenceRuntime, RuntimeState } from "@free-ai-open/ai-runtime";
import { shouldDisposeRuntimeForTrigger, type RuntimeDisposalTrigger } from "../_lib/runtimeLifecyclePolicy";
import { terminateWorkerAfter, type TerminableWorker } from "../_lib/workerTeardown";

export interface PersistentRuntimeLifecycleOptions<TRuntime extends InferenceRuntime, TWorker extends TerminableWorker> {
  createWorker: () => TWorker;
  createRuntime: (worker: TWorker) => TRuntime;
  teardownGraceMs: number;
}

export interface RuntimeInstance<TRuntime extends InferenceRuntime, TWorker extends TerminableWorker> {
  runtime: TRuntime;
  worker: TWorker;
  instanceId: number;
}

export function createPersistentRuntimeLifecycle<
  TRuntime extends InferenceRuntime,
  TWorker extends TerminableWorker,
>({ createWorker, createRuntime, teardownGraceMs }: PersistentRuntimeLifecycleOptions<TRuntime, TWorker>) {
  let current: RuntimeInstance<TRuntime, TWorker> | null = null;
  let unsubscribe: (() => void) | null = null;
  let createdCount = 0;

  function disposeCurrent(trigger: RuntimeDisposalTrigger): boolean {
    if (!shouldDisposeRuntimeForTrigger(trigger)) return false;

    unsubscribe?.();
    unsubscribe = null;

    const instance = current;
    current = null;
    if (!instance) return false;

    terminateWorkerAfter(instance.runtime.dispose(), instance.worker, teardownGraceMs);
    return true;
  }

  function ensureRuntime(listener: (state: RuntimeState) => void): RuntimeInstance<TRuntime, TWorker> {
    if (current) return current;

    const worker = createWorker();
    const runtime = createRuntime(worker);
    const instance = { runtime, worker, instanceId: ++createdCount };
    current = instance;
    unsubscribe = runtime.subscribe(listener);
    return instance;
  }

  function replaceRuntime(
    trigger: Extract<RuntimeDisposalTrigger, "explicit_reload" | "performance_replacement" | "recovery" | "model_replacement">,
    listener: (state: RuntimeState) => void
  ): RuntimeInstance<TRuntime, TWorker> {
    disposeCurrent(trigger);
    return ensureRuntime(listener);
  }

  return {
    ensureRuntime,
    replaceRuntime,
    disposeCurrent,
    getCurrentRuntime: () => current?.runtime ?? null,
    hasRuntime: () => current !== null,
    getCreatedCount: () => createdCount,
  };
}

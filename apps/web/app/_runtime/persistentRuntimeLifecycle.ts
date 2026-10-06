import type { InferenceRuntime, RuntimeState } from "@free-ai-open/ai-runtime";
import { shouldDisposeRuntimeForTrigger, type RuntimeDisposalTrigger } from "../_lib/runtimeLifecyclePolicy";
import { teardownWorker, type TerminableWorker, type WorkerTeardownResult } from "../_lib/workerTeardown";

export interface PersistentRuntimeLifecycleOptions<TRuntime extends InferenceRuntime, TWorker extends TerminableWorker> {
  createWorker: () => TWorker;
  createRuntime: (worker: TWorker) => TRuntime;
  // How long a graceful runtime.dispose() may take before the old worker is
  // force-terminated.
  teardownGraceMs: number;
  // How long a promise-returning worker.terminate() may take to confirm.
  // Defaults to teardownGraceMs. An unconfirmed terminate is NOT isolation.
  terminateConfirmMs?: number;
}

export interface RuntimeInstance<TRuntime extends InferenceRuntime, TWorker extends TerminableWorker> {
  runtime: TRuntime;
  worker: TWorker;
  instanceId: number;
}

export type RuntimeReplacementResult<TRuntime extends InferenceRuntime, TWorker extends TerminableWorker> =
  | { ok: true; instance: RuntimeInstance<TRuntime, TWorker> }
  // The previous worker domain could not be CONFIRMED isolated, so NO
  // replacement was created -- old and new workers are never alive at once.
  | { ok: false; isolated: false; reason: "isolation_unconfirmed" };

function safeDispose(runtime: InferenceRuntime): Promise<unknown> {
  try {
    return runtime.dispose();
  } catch (error) {
    return Promise.reject(error);
  }
}

// Owns exactly one runtime/worker pair at a time, and -- crucially -- makes
// replacement PHYSICALLY SEQUENTIAL:
//
//   mark old runtime unusable (getCurrentRuntime() is null) -> request
//   dispose -> WAIT until the old worker is confirmed terminated (force-
//   terminating after the grace period) -> only then create the replacement.
//
// If termination cannot be confirmed, the old instance is held in quarantine
// and no replacement worker is ever created until a later isolation retry
// succeeds; callers learn this from the returned result and must not release
// shared runtime ownership as if the old domain were gone.
export function createPersistentRuntimeLifecycle<
  TRuntime extends InferenceRuntime,
  TWorker extends TerminableWorker,
>({
  createWorker,
  createRuntime,
  teardownGraceMs,
  terminateConfirmMs = teardownGraceMs,
}: PersistentRuntimeLifecycleOptions<TRuntime, TWorker>) {
  type Instance = RuntimeInstance<TRuntime, TWorker>;
  const teardownOptions = { disposeGraceMs: teardownGraceMs, terminateConfirmMs };

  let current: Instance | null = null;
  let unsubscribe: (() => void) | null = null;
  let createdCount = 0;
  // A teardown that has started but not finished: the old worker may still
  // be alive, so no replacement may be created.
  let pendingTeardown: Promise<WorkerTeardownResult> | null = null;
  // An old instance whose termination could not be confirmed.
  let quarantined: Instance | null = null;
  // Serializes replacements so two never interleave their teardown/create.
  let serial: Promise<unknown> = Promise.resolve();

  function detachCurrent(): Instance | null {
    unsubscribe?.();
    unsubscribe = null;
    const instance = current;
    current = null;
    return instance;
  }

  function startTeardown(instance: Instance): Promise<WorkerTeardownResult> {
    const teardown = teardownWorker(safeDispose(instance.runtime), instance.worker, teardownOptions).then((result) => {
      if (pendingTeardown === teardown) pendingTeardown = null;
      if (!result.isolated) quarantined = instance;
      return result;
    });
    pendingTeardown = teardown;
    return teardown;
  }

  // Retries ONLY termination of an already-quarantined instance (its
  // graceful dispose was already attempted).
  async function retryQuarantinedTermination(): Promise<boolean> {
    if (!quarantined) return true;
    const instance = quarantined;
    const result = await teardownWorker(Promise.resolve(), instance.worker, teardownOptions);
    if (result.isolated && quarantined === instance) quarantined = null;
    return result.isolated;
  }

  // True only when no PREVIOUS (already torn-down, in-flight, or quarantined)
  // worker domain can still be alive. Never touches the live `current`.
  async function confirmPreviousIsolated(): Promise<boolean> {
    if (pendingTeardown) {
      const finished = await pendingTeardown;
      if (!finished.isolated) return false;
    }
    if (quarantined && !(await retryQuarantinedTermination())) return false;
    return !quarantined;
  }

  // Tears down the live runtime (after confirming every previous domain is
  // isolated). True only when NO worker domain, old or current, can still be
  // alive -- the precondition for creating a replacement.
  async function isolateForReplacement(): Promise<boolean> {
    if (!(await confirmPreviousIsolated())) return false;
    const instance = detachCurrent();
    if (instance) {
      const result = await startTeardown(instance);
      if (!result.isolated) return false;
    }
    return !quarantined;
  }

  function createInstance(listener: (state: RuntimeState) => void): Instance {
    const worker = createWorker();
    const runtime = createRuntime(worker);
    const instance = { runtime, worker, instanceId: ++createdCount };
    current = instance;
    unsubscribe = runtime.subscribe(listener);
    return instance;
  }

  function sequence<T>(operation: () => Promise<T>): Promise<T> {
    const run = serial.then(operation);
    serial = run.catch(() => undefined);
    return run;
  }

  // Fire-and-forget disposal for application teardown (nothing replaces the
  // runtime afterwards). Still tracked, so a later creation can never overlap
  // the not-yet-terminated worker.
  function disposeCurrent(trigger: RuntimeDisposalTrigger): boolean {
    if (!shouldDisposeRuntimeForTrigger(trigger)) return false;
    const instance = detachCurrent();
    if (!instance) return false;
    void startTeardown(instance);
    return true;
  }

  // Synchronous access to the existing runtime. Refuses (throws) to create a
  // NEW worker while a previous one is still being torn down or is
  // quarantined -- use ensureRuntimeSequenced() for a creation that must wait.
  function ensureRuntime(listener: (state: RuntimeState) => void): Instance {
    if (current) return current;
    if (pendingTeardown || quarantined) {
      throw new Error("A previous runtime worker is not confirmed isolated; refusing to create a replacement.");
    }
    return createInstance(listener);
  }

  // Like ensureRuntime(), but waits for any in-flight teardown and refuses
  // (never creates) unless the previous domain is confirmed isolated.
  function ensureRuntimeSequenced(
    listener: (state: RuntimeState) => void
  ): Promise<RuntimeReplacementResult<TRuntime, TWorker>> {
    return sequence(async () => {
      if (current) return { ok: true as const, instance: current };
      if (!(await confirmPreviousIsolated())) {
        return { ok: false as const, isolated: false as const, reason: "isolation_unconfirmed" as const };
      }
      return { ok: true as const, instance: createInstance(listener) };
    });
  }

  function replaceRuntime(
    trigger: Extract<RuntimeDisposalTrigger, "explicit_reload" | "performance_replacement" | "recovery" | "model_replacement">,
    listener: (state: RuntimeState) => void
  ): Promise<RuntimeReplacementResult<TRuntime, TWorker>> {
    return sequence(async () => {
      if (shouldDisposeRuntimeForTrigger(trigger) && !(await isolateForReplacement())) {
        return { ok: false as const, isolated: false as const, reason: "isolation_unconfirmed" as const };
      }
      return { ok: true as const, instance: createInstance(listener) };
    });
  }

  // Tears down the LIVE runtime (after confirming every previous domain is
  // isolated) WITHOUT creating a replacement. `isolated: true` means no worker
  // domain, old or current, can still be alive; afterwards there is no runtime
  // (getCurrentRuntime() is null) until something creates one. Used to
  // abandon a replacement whose load will not finish: its worker is isolated
  // too, so an uncooperative load can never outlive the lease that started it.
  function isolateCurrent(): Promise<{ isolated: boolean }> {
    return sequence(async () => ({ isolated: await isolateForReplacement() }));
  }

  // Retries isolation of any previously quarantined/in-flight teardown WITHOUT
  // creating anything. `isolated: true` means no previous worker domain can
  // still be alive.
  function confirmIsolation(): Promise<{ isolated: boolean }> {
    return sequence(async () => ({ isolated: await confirmPreviousIsolated() }));
  }

  return {
    ensureRuntime,
    ensureRuntimeSequenced,
    replaceRuntime,
    disposeCurrent,
    isolateCurrent,
    confirmIsolation,
    getCurrentRuntime: () => current?.runtime ?? null,
    hasRuntime: () => current !== null,
    hasPendingTeardown: () => pendingTeardown !== null,
    isQuarantined: () => quarantined !== null,
    getCreatedCount: () => createdCount,
  };
}

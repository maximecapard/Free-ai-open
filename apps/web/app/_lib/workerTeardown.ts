export interface TerminableWorker {
  // Browsers' Worker.terminate() is synchronous and physically stops the
  // thread; a wrapper may return a promise that settles once termination is
  // confirmed. Either way, "terminate returned/resolved without throwing" is
  // the ONLY thing this module treats as proof the old worker domain is
  // isolated.
  terminate(): void | Promise<void>;
}

export type WorkerTeardownReason =
  | "disposed"
  | "dispose_timeout"
  | "dispose_rejected";

export interface WorkerTeardownResult {
  // The old worker is confirmed terminated (physically isolated): no late
  // message, callback, or engine work from it can ever run again. This is the
  // only fact a caller may rely on before creating a replacement worker.
  isolated: boolean;
  // How the graceful dispose() step ended, for diagnostics only. Termination
  // is attempted in every case -- a wedged or failed dispose never skips it.
  reason: WorkerTeardownReason;
}

export interface WorkerTeardownOptions {
  // How long to wait for a graceful dispose() before force-terminating.
  disposeGraceMs: number;
  // How long to wait for terminate() to confirm when it returns a promise.
  // A terminate that never confirms is NOT proof of isolation.
  terminateConfirmMs: number;
}

type Raced<T> = { kind: "settled"; value: T } | { kind: "timeout" };

function raceWithTimer<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<Raced<T>> {
  return new Promise<Raced<T>>((resolve, reject) => {
    const timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ kind: "settled", value });
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Physically sequential worker teardown: attempts a graceful dispose first,
// never waits longer than `disposeGraceMs` for it, ALWAYS force-terminates
// the worker afterwards (even if dispose rejected or never settled), and only
// reports `isolated: true` once terminate() has actually confirmed.
//
// A caller replacing a runtime MUST await this and MUST NOT create a
// replacement worker unless `isolated` is true -- otherwise old and new
// workers could be alive at the same time.
export async function teardownWorker(
  pending: Promise<unknown>,
  worker: TerminableWorker,
  options: WorkerTeardownOptions,
): Promise<WorkerTeardownResult> {
  // Wrap so a dispose() rejection becomes data (and never an unhandled
  // rejection), while a never-settling dispose is bounded by the grace timer.
  const disposeOutcome = pending.then(
    () => "disposed" as const,
    () => "dispose_rejected" as const,
  );
  const graced = await raceWithTimer(disposeOutcome, options.disposeGraceMs);
  const reason: WorkerTeardownReason =
    graced.kind === "timeout" ? "dispose_timeout" : graced.value;

  let isolated = false;
  try {
    const terminated = worker.terminate();
    if (terminated && typeof (terminated as Promise<void>).then === "function") {
      const confirmed = await raceWithTimer(
        (terminated as Promise<void>).then(() => true as const),
        options.terminateConfirmMs,
      );
      isolated = confirmed.kind === "settled";
    } else {
      isolated = true;
    }
  } catch {
    isolated = false;
  }
  return { isolated, reason };
}

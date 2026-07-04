export interface TerminableWorker {
  terminate(): void;
}

// Guarantees `worker.terminate()` runs even if `pending` (typically
// runtime.dispose()) never settles — e.g. because the underlying engine's
// unload() call is waiting on a worker that is already wedged (observed
// after a cancel timeout or a stalled generation). Attempts a graceful
// dispose first, but never waits longer than `graceMs` for it, and never
// lets a dispose rejection become an unhandled promise rejection.
export function terminateWorkerAfter(pending: Promise<unknown>, worker: TerminableWorker, graceMs: number): void {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
  };

  const timer = setTimeout(finish, graceMs);
  pending.catch(() => {}).finally(() => {
    clearTimeout(timer);
    finish();
  });
}

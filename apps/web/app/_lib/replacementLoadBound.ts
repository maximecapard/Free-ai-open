// Recovery needs two things that must never be confused:
//
//   SAFETY    -- the old runtime domain is physically isolated. This is what
//                a runtime lease's release depends on.
//   READINESS -- a replacement model is loaded and usable. Nice to have, never
//                a precondition for releasing ownership.
//
// Isolation is bounded by construction (see workerTeardown.ts). Readiness is
// bounded HERE: a replacement `loadModel()` cannot be interrupted from outside
// (it has no abort hook), so an uncooperative one -- a wedged download, a
// stuck engine -- would otherwise hold the borrowed generation lease for
// ever. Instead the wait is capped; when the cap is hit the replacement worker
// is itself torn down and isolated (the caller's job), recovery reports
// `{isolated: true, ready: false}`, and the lease is released. The next normal
// routing/load/reload simply tries again.
//
// The cap exists to guarantee the lease comes back, not to be hit: recovery
// only reloads models the user has already approved (typically cached), which
// load in seconds to tens of seconds.
export const RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS = 120_000;

export type DeadlineOutcome<T> =
  | { kind: "settled"; value: T }
  | { kind: "rejected"; error: unknown }
  | { kind: "timeout" };

// Waits for `promise` for at most `timeoutMs` (null = no cap). Never throws and
// never leaves an unhandled rejection: handlers are always attached, so a
// promise that settles LATE (after a timeout) is simply ignored. The timer is
// cleared on every path.
export async function awaitWithDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number | null,
): Promise<DeadlineOutcome<T>> {
  const settled = promise.then<DeadlineOutcome<T>, DeadlineOutcome<T>>(
    (value) => ({ kind: "settled", value }),
    (error: unknown) => ({ kind: "rejected", error }),
  );
  if (timeoutMs === null) return settled;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<DeadlineOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

import { normalizeRuntimeRecoveryResult } from "@free-ai-open/ai-runtime";
import type { RuntimeOperationLease, RuntimeRecoveryResult } from "@free-ai-open/ai-runtime";

// The runtime lease an in-flight generation (sendMessage/Continue) holds,
// wrapped so that watchdog recovery can run UNDER THAT SAME lease instead of
// trying to acquire a second one for the same logical operation.
//
// Ownership rules:
// - The generation owner normally releases the lease in its `finally`
//   (releaseFromOwner()).
// - If the generation's stream never ends (a non-cooperative worker), the
//   owner's `finally` never runs. Watchdog recovery then TAKES OVER the lease
//   (recoverUnderLease()): from that moment the owner's `finally` can no
//   longer release it, so a stream that wakes up mid-recovery can never hand
//   the runtime to a third operation while the old runtime is being replaced.
// - After recovery the lease is RELEASED only if the previous runtime work is
//   proven isolated; otherwise it is QUARANTINED (it stays unavailable to
//   every ordinary operation). Readiness never affects this decision.
export interface GenerationLeaseHandle {
  readonly lease: RuntimeOperationLease;
  // True while the original generation still holds a current lease.
  isLeaseCurrent(): boolean;
  // True once watchdog recovery has taken ownership.
  isRecoveryOwned(): boolean;
  // Called from the owner's `finally`. A no-op once recovery owns the lease.
  releaseFromOwner(): void;
  // Resolves true as soon as the owner (or a recovery) has settled the lease,
  // false if `graceMs` elapses first -- i.e. the generation looks
  // non-cooperative.
  waitForSettlement(graceMs: number): Promise<boolean>;
  // Runs `recover` under this lease and settles it from the result. Returns
  // null when the lease was no longer current (the owner already finished),
  // so the caller can fall back to ordinary recovery. Idempotent: concurrent
  // triggers share one recovery.
  recoverUnderLease(
    recover: (lease: RuntimeOperationLease) => Promise<RuntimeRecoveryResult>,
  ): Promise<RuntimeRecoveryResult | null>;
}

export function createGenerationLeaseHandle(lease: RuntimeOperationLease): GenerationLeaseHandle {
  let recoveryOwns = false;
  let settled = false;
  let resolveSettled!: () => void;
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  let recovery: Promise<RuntimeRecoveryResult> | null = null;

  function markSettled(): void {
    if (settled) return;
    settled = true;
    resolveSettled();
  }

  return {
    lease,
    isLeaseCurrent: () => lease.isCurrent(),
    isRecoveryOwned: () => recoveryOwns,
    releaseFromOwner() {
      if (recoveryOwns) return;
      lease.release();
      markSettled();
    },
    waitForSettlement(graceMs) {
      if (settled) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), graceMs);
        void settledPromise.then(() => {
          clearTimeout(timer);
          resolve(true);
        });
      });
    },
    recoverUnderLease(recover) {
      if (recovery) return recovery;
      if (!lease.isCurrent()) return Promise.resolve(null);

      // Synchronous takeover, before any await.
      recoveryOwns = true;
      recovery = (async () => {
        let result: RuntimeRecoveryResult;
        try {
          result = normalizeRuntimeRecoveryResult(await recover(lease));
        } catch {
          result = { isolated: false, ready: false };
        }
        if (result.isolated) lease.release();
        else lease.quarantine();
        markSettled();
        return result;
      })();
      return recovery;
    },
  };
}

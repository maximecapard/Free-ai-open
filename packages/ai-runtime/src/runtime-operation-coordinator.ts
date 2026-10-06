import { normalizeRuntimeRecoveryResult } from "./runtime-recovery";
import type { RuntimeRecoveryResult } from "./runtime-recovery";

// Generic, content-free ownership for a shared inference runtime. The
// coordinator deliberately knows nothing about chat or benchmarks: callers
// provide only a short diagnostic owner label, and possession of the opaque
// lease is the authority to perform one exclusive runtime operation burst.
//
// Invariant: a lease may only be RELEASED once every piece of work started
// under it is proven quiescent or physically isolated. When that cannot be
// proven, the owner calls quarantine() instead: the coordinator then stays
// unavailable to every ordinary operation until clearQuarantine() is given a
// recovery result that actually proves isolation. A quarantined lease can no
// longer be released (an owner's ordinary `finally { lease.release() }` is a
// harmless no-op), so an early release can never hand a possibly-still-busy
// runtime to a third operation.
export interface RuntimeOperationLease {
  readonly owner: string;
  isCurrent(): boolean;
  release(): boolean;
  // Converts this exclusive hold into a sticky quarantine. Returns false if
  // the lease is no longer current (already released/quarantined).
  quarantine(): boolean;
}

export interface RuntimeOperationCoordinator {
  tryAcquire(owner: string): RuntimeOperationLease | null;
  currentOwner(): string | null;
  isLeaseCurrent(lease: RuntimeOperationLease): boolean;
  isQuarantined(): boolean;
  // Lifts a quarantine, and only when `recovery` proves the previous domain
  // is isolated (isolated === true). Returns false when nothing was
  // quarantined or isolation was not proven.
  clearQuarantine(recovery: RuntimeRecoveryResult): boolean;
}

const QUARANTINE_OWNER = "runtime-quarantine";

export function createRuntimeOperationCoordinator(): RuntimeOperationCoordinator {
  let currentToken: symbol | null = null;
  let currentOwner: string | null = null;
  let quarantined = false;
  const issuedLeases = new WeakSet<RuntimeOperationLease>();

  return {
    tryAcquire(owner) {
      if (
        typeof owner !== "string" ||
        owner.length === 0 ||
        currentToken !== null
      )
        return null;

      const token = Symbol(owner);
      currentToken = token;
      currentOwner = owner;
      let released = false;

      const lease: RuntimeOperationLease = {
        owner,
        isCurrent: () => !released && currentToken === token,
        release: () => {
          if (released || currentToken !== token) return false;
          released = true;
          currentToken = null;
          currentOwner = null;
          return true;
        },
        quarantine: () => {
          if (released || currentToken !== token) return false;
          released = true;
          currentToken = Symbol(QUARANTINE_OWNER);
          currentOwner = QUARANTINE_OWNER;
          quarantined = true;
          return true;
        },
      };
      issuedLeases.add(lease);
      return lease;
    },
    currentOwner: () => currentOwner,
    isLeaseCurrent: (lease) => issuedLeases.has(lease) && lease.isCurrent(),
    isQuarantined: () => quarantined,
    clearQuarantine(recovery) {
      if (!quarantined) return false;
      if (!normalizeRuntimeRecoveryResult(recovery).isolated) return false;
      quarantined = false;
      currentToken = null;
      currentOwner = null;
      return true;
    },
  };
}

// Runtime instances are associated weakly so the ownership primitive does
// not extend their lifetime. Production can deliberately bind successive
// replacement runtimes to one coordinator; tests and isolated runtimes get a
// private coordinator lazily.
const coordinators = new WeakMap<object, RuntimeOperationCoordinator>();

export function associateRuntimeOperationCoordinator(
  runtime: object,
  coordinator: RuntimeOperationCoordinator,
): void {
  const existing = coordinators.get(runtime);
  if (existing && existing !== coordinator) {
    throw new Error(
      "An inference runtime cannot be rebound to a different operation coordinator.",
    );
  }
  coordinators.set(runtime, coordinator);
}

export function getRuntimeOperationCoordinator(
  runtime: object,
): RuntimeOperationCoordinator {
  const existing = coordinators.get(runtime);
  if (existing) return existing;
  const created = createRuntimeOperationCoordinator();
  coordinators.set(runtime, created);
  return created;
}

import { describe, expect, it, vi } from "vitest";
import { createRuntimeOperationCoordinator } from "@free-ai-open/ai-runtime";
import type { RuntimeOperationLease, RuntimeRecoveryResult } from "@free-ai-open/ai-runtime";
import { createGenerationLeaseHandle } from "./generationLeaseOwnership";
import { runRecoveryAction } from "./watchdogRecovery";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const noRouting = async (): Promise<RuntimeRecoveryResult | null> => null;

describe("generation lease ownership", () => {
  it("the owner's ordinary finally releases the lease when nothing took it over", () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);

    handle.releaseFromOwner();

    expect(coordinator.currentOwner()).toBeNull();
    expect(handle.isLeaseCurrent()).toBe(false);
  });

  it("watchdog recovery runs under the SAME lease and never asks the coordinator for a second one", async () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);
    const tryAcquire = vi.spyOn(coordinator, "tryAcquire");
    const seenLeases: RuntimeOperationLease[] = [];

    const result = await runRecoveryAction("recover_runtime", {
      owner: handle,
      recoverRuntime: async (lease) => {
        if (lease) seenLeases.push(lease);
        return { isolated: true, ready: true };
      },
      refreshRoutingDecision: noRouting,
    });

    expect(seenLeases).toEqual([handle.lease]);
    expect(tryAcquire).not.toHaveBeenCalled();
    expect(result).toEqual({ recovery: { isolated: true, ready: true } });
    // Only after recovery completed did the lease become available.
    expect(coordinator.currentOwner()).toBeNull();
  });

  it("a third operation can NOT acquire the runtime while recovery is still running under the owner's lease", async () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);
    const recovery = createDeferred<RuntimeRecoveryResult>();
    let thirdAttemptDuringRecovery: RuntimeOperationLease | null | undefined;

    const running = runRecoveryAction("recover_runtime", {
      owner: handle,
      recoverRuntime: async () => {
        thirdAttemptDuringRecovery = coordinator.tryAcquire("third-operation");
        return recovery.promise;
      },
      refreshRoutingDecision: noRouting,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(thirdAttemptDuringRecovery).toBeNull();
    expect(coordinator.tryAcquire("another")).toBeNull();

    recovery.resolve({ isolated: true, ready: true });
    await running;
    expect(coordinator.tryAcquire("after-recovery")).not.toBeNull();
  });

  it("a stream that wakes up mid-recovery and runs the owner's finally can NOT release the lease out from under recovery", async () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);
    const recovery = createDeferred<RuntimeRecoveryResult>();

    const running = runRecoveryAction("recover_runtime", {
      owner: handle,
      recoverRuntime: () => recovery.promise,
      refreshRoutingDecision: noRouting,
    });
    await Promise.resolve();

    // The old, non-cooperative stream finally ends while recovery runs.
    handle.releaseFromOwner();

    expect(coordinator.currentOwner()).toBe("chat-generation");
    expect(coordinator.tryAcquire("third")).toBeNull();

    recovery.resolve({ isolated: true, ready: true });
    await running;
    expect(coordinator.currentOwner()).toBeNull();
  });

  it("isolated=true, ready=false releases ownership (the old domain is gone) but reports the runtime as not usable", async () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);

    const result = await runRecoveryAction("recover_runtime", {
      owner: handle,
      recoverRuntime: async () => ({ isolated: true, ready: false }),
      refreshRoutingDecision: noRouting,
    });

    expect(result).toEqual({ recovery: { isolated: true, ready: false } });
    expect(coordinator.isQuarantined()).toBe(false);
    expect(coordinator.tryAcquire("next-chat")).not.toBeNull();
  });

  it("isolated=false QUARANTINES the lease: the coordinator never becomes available to normal operations", async () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);

    const result = await runRecoveryAction("recover_runtime", {
      owner: handle,
      recoverRuntime: async () => ({ isolated: false, ready: false }),
      refreshRoutingDecision: noRouting,
    });

    expect(result).toEqual({ recovery: { isolated: false, ready: false } });
    expect(coordinator.isQuarantined()).toBe(true);
    expect(coordinator.tryAcquire("next-chat")).toBeNull();
    // The owner's late `finally` cannot undo the quarantine either.
    handle.releaseFromOwner();
    expect(coordinator.tryAcquire("still-blocked")).toBeNull();
  });

  it("a recovery that rejects or claims ready without isolation also quarantines instead of releasing", async () => {
    for (const recover of [
      async (): Promise<RuntimeRecoveryResult> => {
        throw new Error("recovery crashed");
      },
      async (): Promise<RuntimeRecoveryResult> => ({ isolated: false, ready: true }),
    ]) {
      const coordinator = createRuntimeOperationCoordinator();
      const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);

      await runRecoveryAction("recover_runtime", { owner: handle, recoverRuntime: recover, refreshRoutingDecision: noRouting });

      expect(coordinator.isQuarantined()).toBe(true);
      expect(coordinator.tryAcquire("next")).toBeNull();
    }
  });

  it("falls back to ordinary recovery when the owner already finished before the watchdog acted", async () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);
    handle.releaseFromOwner();
    const lease = vi.fn();

    const result = await runRecoveryAction("recover_runtime", {
      owner: handle,
      recoverRuntime: async (borrowed) => {
        lease(borrowed);
        return { isolated: true, ready: true };
      },
      refreshRoutingDecision: noRouting,
    });

    expect(lease).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ recovery: { isolated: true, ready: true } });
  });

  it("refresh_routing: when the owner finishes by itself, no runtime recovery runs and the reroute happens after it released", async () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);
    const recoverRuntime = vi.fn(async () => ({ isolated: true, ready: true }));
    let leaseHeldDuringReroute: boolean | null = null;
    const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => {
      leaseHeldDuringReroute = coordinator.currentOwner() !== null;
      return null;
    };

    const running = runRecoveryAction("refresh_routing", { owner: handle, recoverRuntime, refreshRoutingDecision });
    await Promise.resolve();
    handle.releaseFromOwner();
    const result = await running;

    expect(recoverRuntime).not.toHaveBeenCalled();
    expect(leaseHeldDuringReroute).toBe(false);
    expect(result).toEqual({ recovery: null });
  });

  it("refresh_routing: a NON-COOPERATIVE stream is isolated under the lease after the grace period, and the reroute only runs once the lease is gone", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = createRuntimeOperationCoordinator();
      const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);
      const events: string[] = [];
      const recoverRuntime = vi.fn(async (lease?: RuntimeOperationLease) => {
        events.push(`recover:${lease === handle.lease ? "owner-lease" : "other"}`);
        return { isolated: true, ready: true };
      });
      const refreshRoutingDecision = async (): Promise<RuntimeRecoveryResult | null> => {
        events.push(`reroute:${coordinator.currentOwner() === null ? "lease-free" : "lease-held"}`);
        return null;
      };

      const running = runRecoveryAction("refresh_routing", {
        owner: handle,
        recoverRuntime,
        refreshRoutingDecision,
        ownerReleaseGraceMs: 5_000,
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(recoverRuntime).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      const result = await running;

      expect(events).toEqual(["recover:owner-lease", "reroute:lease-free"]);
      expect(result).toEqual({ recovery: { isolated: true, ready: true } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("two concurrent watchdog triggers share ONE recovery under the lease", async () => {
    const coordinator = createRuntimeOperationCoordinator();
    const handle = createGenerationLeaseHandle(coordinator.tryAcquire("chat-generation")!);
    const recoverRuntime = vi.fn(async () => ({ isolated: true, ready: true }));

    const [first, second] = await Promise.all([
      runRecoveryAction("recover_runtime", { owner: handle, recoverRuntime, refreshRoutingDecision: noRouting }),
      runRecoveryAction("recover_runtime", { owner: handle, recoverRuntime, refreshRoutingDecision: noRouting }),
    ]);

    expect(recoverRuntime).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });
});

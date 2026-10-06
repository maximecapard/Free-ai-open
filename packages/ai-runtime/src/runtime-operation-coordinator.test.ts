import { describe, expect, it } from "vitest";
import {
  associateRuntimeOperationCoordinator,
  createRuntimeOperationCoordinator,
  getRuntimeOperationCoordinator,
} from "./runtime-operation-coordinator";

describe("runtime operation coordinator", () => {
  it("grants one exclusive lease and releases it", () => {
    const coordinator = createRuntimeOperationCoordinator();
    const first = coordinator.tryAcquire("first");

    expect(first?.isCurrent()).toBe(true);
    expect(first && coordinator.isLeaseCurrent(first)).toBe(true);
    expect(coordinator.currentOwner()).toBe("first");
    expect(coordinator.tryAcquire("second")).toBeNull();
    expect(first?.release()).toBe(true);
    expect(first?.isCurrent()).toBe(false);
    expect(first && coordinator.isLeaseCurrent(first)).toBe(false);
    expect(coordinator.currentOwner()).toBeNull();
  });

  it("makes double and stale release fail closed", () => {
    const coordinator = createRuntimeOperationCoordinator();
    const stale = coordinator.tryAcquire("stale")!;
    expect(stale.release()).toBe(true);

    const current = coordinator.tryAcquire("current")!;
    expect(stale.release()).toBe(false);
    expect(current.isCurrent()).toBe(true);
    expect(coordinator.currentOwner()).toBe("current");
    expect(current.release()).toBe(true);
    expect(current.release()).toBe(false);
  });

  it("quarantine keeps the coordinator unavailable and makes the owner's later release a harmless no-op", () => {
    const coordinator = createRuntimeOperationCoordinator();
    const lease = coordinator.tryAcquire("owner")!;

    expect(lease.quarantine()).toBe(true);
    expect(coordinator.isQuarantined()).toBe(true);
    expect(lease.isCurrent()).toBe(false);
    // The ordinary `finally { lease.release() }` of the original owner can
    // never hand a possibly-still-busy runtime to a third operation.
    expect(lease.release()).toBe(false);
    expect(lease.quarantine()).toBe(false);
    expect(coordinator.tryAcquire("third")).toBeNull();
    expect(coordinator.currentOwner()).toBe("runtime-quarantine");
  });

  it("only a recovery result that proves isolation can lift a quarantine", () => {
    const coordinator = createRuntimeOperationCoordinator();
    expect(coordinator.clearQuarantine({ isolated: true, ready: true })).toBe(false);

    coordinator.tryAcquire("owner")!.quarantine();

    expect(coordinator.clearQuarantine({ isolated: false, ready: false })).toBe(false);
    // A contradictory "ready but not isolated" claim, a legacy boolean, and
    // garbage all fail closed.
    expect(coordinator.clearQuarantine({ isolated: false, ready: true })).toBe(false);
    expect(coordinator.clearQuarantine(true as never)).toBe(false);
    expect(coordinator.clearQuarantine(undefined as never)).toBe(false);
    expect(coordinator.isQuarantined()).toBe(true);
    expect(coordinator.tryAcquire("blocked")).toBeNull();

    expect(coordinator.clearQuarantine({ isolated: true, ready: false })).toBe(true);
    expect(coordinator.isQuarantined()).toBe(false);
    expect(coordinator.tryAcquire("next")).not.toBeNull();
  });

  it("a stale lease from before a quarantine cycle cannot release the next owner's hold", () => {
    const coordinator = createRuntimeOperationCoordinator();
    const first = coordinator.tryAcquire("first")!;
    first.quarantine();
    coordinator.clearQuarantine({ isolated: true, ready: false });

    const second = coordinator.tryAcquire("second")!;
    expect(first.release()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(coordinator.currentOwner()).toBe("second");
  });

  it("does not allow a runtime to be rebound to a second coordinator", () => {
    const runtime = {};
    const original = createRuntimeOperationCoordinator();
    associateRuntimeOperationCoordinator(runtime, original);

    expect(() =>
      associateRuntimeOperationCoordinator(runtime, original),
    ).not.toThrow();
    expect(() =>
      associateRuntimeOperationCoordinator(
        runtime,
        createRuntimeOperationCoordinator(),
      ),
    ).toThrow(/cannot be rebound/);
    expect(getRuntimeOperationCoordinator(runtime)).toBe(original);
  });
});

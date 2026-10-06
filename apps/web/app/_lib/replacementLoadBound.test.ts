import { afterEach, describe, expect, it, vi } from "vitest";
import { RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS, awaitWithDeadline } from "./replacementLoadBound";

afterEach(() => {
  vi.useRealTimers();
});

describe("awaitWithDeadline", () => {
  it("reports a promise that settles in time", async () => {
    await expect(awaitWithDeadline(Promise.resolve(42), 1_000)).resolves.toEqual({ kind: "settled", value: 42 });
  });

  it("reports a rejection as data, never as a throw", async () => {
    const error = new Error("boom");
    await expect(awaitWithDeadline(Promise.reject(error), 1_000)).resolves.toEqual({ kind: "rejected", error });
  });

  it("gives up on a promise that never settles, after exactly the deadline", async () => {
    vi.useFakeTimers();
    const outcome = awaitWithDeadline(new Promise<never>(() => {}), 500);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toEqual({ kind: "timeout" });
  });

  it("clears its timer on every path", async () => {
    vi.useFakeTimers();
    await awaitWithDeadline(Promise.resolve(1), 1_000);
    expect(vi.getTimerCount()).toBe(0);
    await awaitWithDeadline(Promise.reject(new Error("x")), 1_000);
    expect(vi.getTimerCount()).toBe(0);
    const pending = awaitWithDeadline(new Promise<never>(() => {}), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a promise that settles LATE (rejecting, even) after the timeout is ignored and never becomes an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let rejectLate!: (error: unknown) => void;
      const late = new Promise<never>((_resolve, reject) => {
        rejectLate = reject;
      });
      vi.useFakeTimers();
      const outcome = awaitWithDeadline(late, 100);
      await vi.advanceTimersByTimeAsync(100);
      await expect(outcome).resolves.toEqual({ kind: "timeout" });

      rejectLate(new Error("too late"));
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a null deadline means no cap: it waits for the promise however long it takes", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const slow = new Promise<string>((res) => {
      resolve = res;
    });
    const outcome = awaitWithDeadline(slow, null);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
    resolve("finally");
    await expect(outcome).resolves.toEqual({ kind: "settled", value: "finally" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovery's replacement-load cap is finite and generous enough for a cached reload", () => {
    expect(Number.isFinite(RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS)).toBe(true);
    expect(RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});

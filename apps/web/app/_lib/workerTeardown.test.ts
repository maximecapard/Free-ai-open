import { describe, expect, it, vi } from "vitest";
import { teardownWorker } from "./workerTeardown";

const options = { disposeGraceMs: 2000, terminateConfirmMs: 1000 };

describe("teardownWorker", () => {
  it("terminates the worker once the pending promise resolves, well before the grace period, and reports isolation", async () => {
    const worker = { terminate: vi.fn() };

    const result = await teardownWorker(Promise.resolve(), worker, options);

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ isolated: true, reason: "disposed" });
  });

  it("force-terminates even if the pending promise never settles (a wedged dispose()), only after the grace period", async () => {
    vi.useFakeTimers();
    try {
      const worker = { terminate: vi.fn() };
      const neverResolves = new Promise<void>(() => {});

      const settled = vi.fn();
      const teardown = teardownWorker(neverResolves, worker, options).then(settled);
      await vi.advanceTimersByTimeAsync(1999);
      expect(worker.terminate).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await teardown;

      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(settled).toHaveBeenCalledWith({ isolated: true, reason: "dispose_timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still terminates when the pending promise rejects, without an unhandled rejection", async () => {
    const worker = { terminate: vi.fn() };

    const result = await teardownWorker(Promise.reject(new Error("dispose failed")), worker, options);

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ isolated: true, reason: "dispose_rejected" });
  });

  it("only terminates once, whichever of the promise or the timer settles first", async () => {
    vi.useFakeTimers();
    try {
      const worker = { terminate: vi.fn() };
      let resolvePending: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        resolvePending = resolve;
      });

      const teardown = teardownWorker(pending, worker, options);
      resolvePending?.();
      await vi.advanceTimersByTimeAsync(2000);
      await teardown;

      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT report isolation when terminate() throws -- the old domain may still be alive", async () => {
    const worker = {
      terminate: vi.fn(() => {
        throw new Error("terminate failed");
      }),
    };

    const result = await teardownWorker(Promise.resolve(), worker, options);

    expect(result.isolated).toBe(false);
  });

  it("does NOT report isolation when an async terminate() rejects", async () => {
    const worker = { terminate: vi.fn(() => Promise.reject(new Error("no"))) };

    const result = await teardownWorker(Promise.resolve(), worker, options);

    expect(result.isolated).toBe(false);
  });

  it("does NOT report isolation when an async terminate() never confirms, and does not wait forever", async () => {
    vi.useFakeTimers();
    try {
      const worker = { terminate: vi.fn(() => new Promise<void>(() => {})) };

      const teardown = teardownWorker(Promise.resolve(), worker, options);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await teardown;

      expect(result.isolated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports isolation once an async terminate() confirms", async () => {
    const worker = { terminate: vi.fn(async () => {}) };

    const result = await teardownWorker(Promise.resolve(), worker, options);

    expect(result.isolated).toBe(true);
  });
});

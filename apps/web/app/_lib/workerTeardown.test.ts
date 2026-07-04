import { describe, expect, it, vi } from "vitest";
import { terminateWorkerAfter } from "./workerTeardown";

function flushMicrotasks(times = 5): Promise<void> {
  return new Promise((resolve) => {
    let count = 0;
    function tick() {
      count += 1;
      if (count >= times) {
        resolve();
        return;
      }
      Promise.resolve().then(tick);
    }
    tick();
  });
}

describe("terminateWorkerAfter", () => {
  it("terminates the worker once the pending promise resolves, well before the grace period", async () => {
    const worker = { terminate: vi.fn() };

    terminateWorkerAfter(Promise.resolve(), worker, 2000);
    await flushMicrotasks();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker even if the pending promise never settles (a wedged dispose())", async () => {
    vi.useFakeTimers();
    try {
      const worker = { terminate: vi.fn() };
      const neverResolves = new Promise<void>(() => {});

      terminateWorkerAfter(neverResolves, worker, 2000);
      expect(worker.terminate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);

      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates the worker even if the pending promise rejects, without an unhandled rejection", async () => {
    const worker = { terminate: vi.fn() };

    terminateWorkerAfter(Promise.reject(new Error("dispose failed")), worker, 2000);
    await flushMicrotasks();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("only terminates once, whichever of the promise or the timer settles first", async () => {
    vi.useFakeTimers();
    try {
      const worker = { terminate: vi.fn() };
      let resolvePending: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        resolvePending = resolve;
      });

      terminateWorkerAfter(pending, worker, 2000);
      resolvePending?.();
      await vi.advanceTimersByTimeAsync(2000);

      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import type { GenerateChunk, RuntimeState } from "@free-ai-open/ai-runtime";
import type { InferenceRuntime } from "@free-ai-open/ai-runtime";
import { createPersistentRuntimeLifecycle } from "./persistentRuntimeLifecycle";

function createFakeRuntime(dispose: () => Promise<void> = async () => {}): InferenceRuntime {
  const state: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };

  return {
    getState: vi.fn(() => state),
    subscribe: vi.fn(() => vi.fn()),
    loadModel: vi.fn(async () => null),
    generate: vi.fn(async function* (): AsyncGenerator<GenerateChunk> {}),
    stopGeneration: vi.fn(),
    setGenerationWatchdogSuspended: vi.fn(),
    dispose: vi.fn(dispose),
  };
}

function createFakeWorker(terminate: () => void | Promise<void> = () => {}) {
  return { terminate: vi.fn(terminate) };
}

async function flushDisposal() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("persistent runtime lifecycle", () => {
  it("reuses the same runtime instance when the application provider stays mounted", () => {
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker: createFakeWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    const listener = vi.fn();

    const first = lifecycle.ensureRuntime(listener);
    const second = lifecycle.ensureRuntime(listener);

    expect(second).toBe(first);
    expect(lifecycle.getCreatedCount()).toBe(1);
    expect(first.runtime.subscribe).toHaveBeenCalledTimes(1);
  });

  it("does not dispose or terminate the worker for a route view unmount", async () => {
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker: createFakeWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    const instance = lifecycle.ensureRuntime(vi.fn());

    expect(lifecycle.disposeCurrent("route_view_unmount")).toBe(false);
    await flushDisposal();

    expect(instance.runtime.dispose).not.toHaveBeenCalled();
    expect(instance.worker.terminate).not.toHaveBeenCalled();
    expect(lifecycle.getCurrentRuntime()).toBe(instance.runtime);
  });

  it("keeps one runtime across internal Chat, Settings, and Debug route transitions", async () => {
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker: createFakeWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    const listener = vi.fn();
    const first = lifecycle.ensureRuntime(listener);

    lifecycle.disposeCurrent("route_view_unmount");
    const afterSettings = lifecycle.ensureRuntime(listener);
    lifecycle.disposeCurrent("route_view_unmount");
    const afterDebug = lifecycle.ensureRuntime(listener);
    await flushDisposal();

    expect(afterSettings).toBe(first);
    expect(afterDebug).toBe(first);
    expect(lifecycle.getCreatedCount()).toBe(1);
    expect(first.runtime.dispose).not.toHaveBeenCalled();
    expect(first.worker.terminate).not.toHaveBeenCalled();
  });

  it("does not dispose or terminate the worker when a tab becomes hidden", async () => {
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker: createFakeWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    const instance = lifecycle.ensureRuntime(vi.fn());

    expect(lifecycle.disposeCurrent("visibility_hidden")).toBe(false);
    await flushDisposal();

    expect(instance.runtime.dispose).not.toHaveBeenCalled();
    expect(instance.worker.terminate).not.toHaveBeenCalled();
  });

  it("terminates the old worker on explicit reload before creating the replacement runtime", async () => {
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker: createFakeWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    const listener = vi.fn();
    const first = lifecycle.ensureRuntime(listener);

    const replaced = await lifecycle.replaceRuntime("explicit_reload", listener);

    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.instance).not.toBe(first);
    expect(lifecycle.getCreatedCount()).toBe(2);
    expect(first.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(first.worker.terminate).toHaveBeenCalledTimes(1);
    expect(replaced.instance.runtime.dispose).not.toHaveBeenCalled();
  });

  it("cleans up the runtime on application-root teardown", async () => {
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker: createFakeWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    const instance = lifecycle.ensureRuntime(vi.fn());

    expect(lifecycle.disposeCurrent("app_root_unmount")).toBe(true);
    await flushDisposal();

    expect(instance.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(instance.worker.terminate).toHaveBeenCalledTimes(1);
    expect(lifecycle.getCurrentRuntime()).toBeNull();
  });
});

describe("persistent runtime lifecycle -- physically sequential replacement", () => {
  it("does NOT create the replacement runtime or worker while the old teardown is still blocked, and only creates it after the old worker terminated", async () => {
    const blockedDispose = createDeferred();
    const workers: Array<ReturnType<typeof createFakeWorker>> = [];
    const createWorker = vi.fn(() => {
      const worker = createFakeWorker();
      workers.push(worker);
      return worker;
    });
    let runtimeCount = 0;
    const createRuntime = vi.fn(() => {
      runtimeCount += 1;
      return runtimeCount === 1 ? createFakeRuntime(() => blockedDispose.promise) : createFakeRuntime();
    });
    const lifecycle = createPersistentRuntimeLifecycle({ createWorker, createRuntime, teardownGraceMs: 60_000 });
    const listener = vi.fn();
    const first = lifecycle.ensureRuntime(listener);
    expect(createWorker).toHaveBeenCalledTimes(1);

    let replaced: Awaited<ReturnType<typeof lifecycle.replaceRuntime>> | null = null;
    const replacement = lifecycle.replaceRuntime("recovery", listener).then((result) => {
      replaced = result;
    });
    await flushDisposal();

    // dispose() started, but is deliberately blocked: the old worker is NOT
    // terminated yet and NO replacement worker/runtime exists.
    expect(first.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(first.worker.terminate).not.toHaveBeenCalled();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(lifecycle.hasPendingTeardown()).toBe(true);
    expect(lifecycle.getCurrentRuntime()).toBeNull();
    expect(replaced).toBeNull();

    // Old teardown completes -> old worker terminated -> ONLY THEN the
    // replacement is created.
    blockedDispose.resolve();
    await replacement;

    expect(first.worker.terminate).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(createRuntime).toHaveBeenCalledTimes(2);
    const result = replaced as Awaited<ReturnType<typeof lifecycle.replaceRuntime>> | null;
    expect(result?.ok).toBe(true);
    expect(lifecycle.getCreatedCount()).toBe(2);
  });

  it("force-terminates a wedged dispose after the grace period and only then creates the replacement", async () => {
    vi.useFakeTimers();
    try {
      const createWorker = vi.fn(() => createFakeWorker());
      let runtimeCount = 0;
      const createRuntime = vi.fn(() => {
        runtimeCount += 1;
        return runtimeCount === 1 ? createFakeRuntime(() => new Promise<void>(() => {})) : createFakeRuntime();
      });
      const lifecycle = createPersistentRuntimeLifecycle({ createWorker, createRuntime, teardownGraceMs: 2_000 });
      const first = lifecycle.ensureRuntime(vi.fn());

      const replacement = lifecycle.replaceRuntime("model_replacement", vi.fn());
      await vi.advanceTimersByTimeAsync(1_999);
      expect(first.worker.terminate).not.toHaveBeenCalled();
      expect(createWorker).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      const result = await replacement;

      expect(first.worker.terminate).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(createWorker).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still terminates and then replaces when the old dispose() rejects", async () => {
    const createWorker = vi.fn(() => createFakeWorker());
    let runtimeCount = 0;
    const createRuntime = vi.fn(() => {
      runtimeCount += 1;
      return runtimeCount === 1 ? createFakeRuntime(() => Promise.reject(new Error("teardown failed"))) : createFakeRuntime();
    });
    const lifecycle = createPersistentRuntimeLifecycle({ createWorker, createRuntime, teardownGraceMs: 2_000 });
    const first = lifecycle.ensureRuntime(vi.fn());

    const result = await lifecycle.replaceRuntime("explicit_reload", vi.fn());

    expect(first.worker.terminate).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("NEVER creates a replacement when the old worker cannot be confirmed terminated, and reports non-isolation", async () => {
    const createWorker = vi.fn(() =>
      createFakeWorker(() => {
        throw new Error("terminate failed");
      })
    );
    const createRuntime = vi.fn(() => createFakeRuntime());
    const lifecycle = createPersistentRuntimeLifecycle({ createWorker, createRuntime, teardownGraceMs: 2_000 });
    lifecycle.ensureRuntime(vi.fn());

    const result = await lifecycle.replaceRuntime("recovery", vi.fn());

    expect(result).toEqual({ ok: false, isolated: false, reason: "isolation_unconfirmed" });
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(lifecycle.isQuarantined()).toBe(true);
    expect(lifecycle.hasRuntime()).toBe(false);
    // A synchronous creation attempt is refused as well.
    expect(() => lifecycle.ensureRuntime(vi.fn())).toThrow(/not confirmed isolated/);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("an unconfirmed (never-settling) async terminate is not isolation and creates no replacement", async () => {
    vi.useFakeTimers();
    try {
      const createWorker = vi.fn(() => createFakeWorker(() => new Promise<void>(() => {})));
      const lifecycle = createPersistentRuntimeLifecycle({
        createWorker,
        createRuntime: () => createFakeRuntime(),
        teardownGraceMs: 1_000,
        terminateConfirmMs: 1_000,
      });
      lifecycle.ensureRuntime(vi.fn());

      const replacement = lifecycle.replaceRuntime("recovery", vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await replacement;

      expect(result.ok).toBe(false);
      expect(createWorker).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries isolation of a quarantined worker and only then permits a replacement", async () => {
    let terminateShouldFail = true;
    const createWorker = vi.fn(() =>
      createFakeWorker(() => {
        if (terminateShouldFail) throw new Error("terminate failed");
      })
    );
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    lifecycle.ensureRuntime(vi.fn());
    expect((await lifecycle.replaceRuntime("recovery", vi.fn())).ok).toBe(false);

    expect(await lifecycle.confirmIsolation()).toEqual({ isolated: false });
    expect(lifecycle.isQuarantined()).toBe(true);

    terminateShouldFail = false;
    expect(await lifecycle.confirmIsolation()).toEqual({ isolated: true });
    expect(lifecycle.isQuarantined()).toBe(false);

    const result = await lifecycle.replaceRuntime("recovery", vi.fn());
    expect(result.ok).toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("a fire-and-forget application teardown still blocks a creation that would overlap its unterminated worker", async () => {
    const blockedDispose = createDeferred();
    const createWorker = vi.fn(() => createFakeWorker());
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker,
      createRuntime: () => createFakeRuntime(() => blockedDispose.promise),
      teardownGraceMs: 60_000,
    });
    const first = lifecycle.ensureRuntime(vi.fn());

    expect(lifecycle.disposeCurrent("app_root_unmount")).toBe(true);
    expect(() => lifecycle.ensureRuntime(vi.fn())).toThrow(/not confirmed isolated/);

    const sequenced = lifecycle.ensureRuntimeSequenced(vi.fn());
    await flushDisposal();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(first.worker.terminate).not.toHaveBeenCalled();

    blockedDispose.resolve();
    const result = await sequenced;

    expect(first.worker.terminate).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("serializes two concurrent replacements so their teardown/creation never interleave", async () => {
    const order: string[] = [];
    let workerCount = 0;
    const createWorker = vi.fn(() => {
      workerCount += 1;
      const id = workerCount;
      order.push(`create:${id}`);
      return createFakeWorker(() => {
        order.push(`terminate:${id}`);
      });
    });
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    lifecycle.ensureRuntime(vi.fn());

    const [a, b] = await Promise.all([
      lifecycle.replaceRuntime("recovery", vi.fn()),
      lifecycle.replaceRuntime("model_replacement", vi.fn()),
    ]);

    expect(a.ok && b.ok).toBe(true);
    expect(order).toEqual(["create:1", "terminate:1", "create:2", "terminate:2", "create:3"]);
  });
});

describe("persistent runtime lifecycle -- isolateCurrent (abandoning a replacement)", () => {
  it("tears the LIVE runtime's worker down and creates NOTHING: afterwards there is no runtime and no new worker", async () => {
    const order: string[] = [];
    let workerCount = 0;
    const createWorker = vi.fn(() => {
      workerCount += 1;
      const id = workerCount;
      order.push(`create:${id}`);
      return createFakeWorker(() => {
        order.push(`terminate:${id}`);
      });
    });
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    lifecycle.ensureRuntime(vi.fn());

    await expect(lifecycle.isolateCurrent()).resolves.toEqual({ isolated: true });

    expect(order).toEqual(["create:1", "terminate:1"]);
    expect(lifecycle.hasRuntime()).toBe(false);
    expect(lifecycle.getCurrentRuntime()).toBeNull();
    expect(lifecycle.isQuarantined()).toBe(false);
    // A later, explicit creation works normally (the previous domain is gone).
    const replacement = await lifecycle.ensureRuntimeSequenced(vi.fn());
    expect(replacement.ok).toBe(true);
    expect(order).toEqual(["create:1", "terminate:1", "create:2"]);
  });

  it("when the live worker cannot be confirmed terminated it reports non-isolation, keeps it quarantined, and still creates nothing", async () => {
    const createWorker = vi.fn(() =>
      createFakeWorker(() => {
        throw new Error("terminate failed");
      })
    );
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });
    lifecycle.ensureRuntime(vi.fn());

    await expect(lifecycle.isolateCurrent()).resolves.toEqual({ isolated: false });

    expect(lifecycle.isQuarantined()).toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(1);
    const refused = await lifecycle.ensureRuntimeSequenced(vi.fn());
    expect(refused).toEqual({ ok: false, isolated: false, reason: "isolation_unconfirmed" });
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("is a harmless no-op when there is no live runtime", async () => {
    const createWorker = vi.fn(() => createFakeWorker());
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker,
      createRuntime: () => createFakeRuntime(),
      teardownGraceMs: 2_000,
    });

    await expect(lifecycle.isolateCurrent()).resolves.toEqual({ isolated: true });
    expect(createWorker).not.toHaveBeenCalled();
  });
});

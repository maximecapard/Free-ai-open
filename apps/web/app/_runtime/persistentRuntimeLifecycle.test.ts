import { describe, expect, it, vi } from "vitest";
import type { GenerateChunk, RuntimeState } from "@free-ai-open/ai-runtime";
import type { InferenceRuntime } from "@free-ai-open/ai-runtime";
import { createPersistentRuntimeLifecycle } from "./persistentRuntimeLifecycle";

function createFakeRuntime(): InferenceRuntime {
  const state: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };

  return {
    getState: vi.fn(() => state),
    subscribe: vi.fn(() => vi.fn()),
    loadModel: vi.fn(async () => {}),
    generate: vi.fn(async function* (): AsyncGenerator<GenerateChunk> {}),
    stopGeneration: vi.fn(),
    dispose: vi.fn(async () => {}),
  };
}

function createFakeWorker() {
  return { terminate: vi.fn() };
}

async function flushDisposal() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("persistent runtime lifecycle", () => {
  it("reuses the same runtime instance when the application provider stays mounted", () => {
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker: createFakeWorker,
      createRuntime: createFakeRuntime,
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
      createRuntime: createFakeRuntime,
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
      createRuntime: createFakeRuntime,
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
      createRuntime: createFakeRuntime,
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
      createRuntime: createFakeRuntime,
      teardownGraceMs: 2_000,
    });
    const listener = vi.fn();
    const first = lifecycle.ensureRuntime(listener);
    const second = lifecycle.replaceRuntime("explicit_reload", listener);
    await flushDisposal();

    expect(second).not.toBe(first);
    expect(lifecycle.getCreatedCount()).toBe(2);
    expect(first.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(first.worker.terminate).toHaveBeenCalledTimes(1);
    expect(second.runtime.dispose).not.toHaveBeenCalled();
  });

  it("cleans up the runtime on application-root teardown", async () => {
    const lifecycle = createPersistentRuntimeLifecycle({
      createWorker: createFakeWorker,
      createRuntime: createFakeRuntime,
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

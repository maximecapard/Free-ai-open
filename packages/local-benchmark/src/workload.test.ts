import { describe, expect, it, vi } from "vitest";
import { runWebGpuBenchmarkWorkload } from "./workload";
import type { BenchmarkWorkloadConfig, WebGpuDeviceLike, WebGpuEnvironment } from "./types";

const config: BenchmarkWorkloadConfig = { elementCount: 8, iterations: 3, warmupCount: 1, sampleCount: 3 };

function expected(index: number): number {
  let value = index + 1;
  for (let i = 0; i < config.iterations; i += 1) value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
  return value;
}

function createEnvironment(valid = true) {
  const data = new Uint32Array(config.elementCount);
  for (let index = 0; index < data.length; index += 1) data[index] = valid ? expected(index) : 0;
  const destroyBuffer = vi.fn();
  const unmap = vi.fn();
  const readBuffer = { mapAsync: vi.fn(async () => undefined), getMappedRange: () => data.buffer, unmap, destroy: destroyBuffer };
  const storageBuffer = { ...readBuffer, destroy: destroyBuffer };
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() };
  const encoder = { beginComputePass: () => pass, copyBufferToBuffer: vi.fn(), finish: () => ({}) };
  const destroyDevice = vi.fn();
  let bufferCount = 0;
  const device = {
    createShaderModule: () => ({}),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: () => (bufferCount++ % 2 === 0 ? storageBuffer : readBuffer),
    createCommandEncoder: () => encoder,
    queue: { submit: vi.fn(), onSubmittedWorkDone: vi.fn(async () => undefined) },
    destroy: destroyDevice,
  } as unknown as WebGpuDeviceLike;
  let time = 0;
  const environment: WebGpuEnvironment = {
    navigator: { gpu: { requestAdapter: async () => ({ requestDevice: async () => device }) } },
    now: () => ++time,
    createBindGroup: () => ({}),
  };
  return { environment, destroyBuffer, destroyDevice, unmap };
}

describe("WebGPU benchmark workload", () => {
  it("returns unsupported without WebGPU", async () => {
    const outcome = await runWebGpuBenchmarkWorkload(config, new AbortController().signal, {
      navigator: {}, now: () => 0, createBindGroup: () => ({}),
    });
    expect(outcome).toEqual({ ok: false, error: { errorCode: "webgpu_unavailable" } });
  });

  it("validates deterministic output and always destroys resources", async () => {
    const { environment, destroyBuffer, destroyDevice, unmap } = createEnvironment();
    const outcome = await runWebGpuBenchmarkWorkload(config, new AbortController().signal, environment);
    expect(outcome).toMatchObject({ ok: true, value: { samplesMs: [1, 1, 1], timingMethod: "wall-clock" } });
    expect(unmap).toHaveBeenCalledOnce();
    expect(destroyBuffer).toHaveBeenCalledTimes(2);
    expect(destroyDevice).toHaveBeenCalledOnce();
  });

  it("rejects invalid output and still destroys resources", async () => {
    const { environment, destroyBuffer, destroyDevice } = createEnvironment(false);
    const outcome = await runWebGpuBenchmarkWorkload(config, new AbortController().signal, environment);
    expect(outcome).toEqual({ ok: false, error: { errorCode: "invalid_compute_result" } });
    expect(destroyBuffer).toHaveBeenCalledTimes(2);
    expect(destroyDevice).toHaveBeenCalledOnce();
  });
});

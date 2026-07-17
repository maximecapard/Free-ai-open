import type { BenchmarkWorkloadConfig, BenchmarkWorkloadOutcome, WebGpuEnvironment } from "./types";

const GPU_BUFFER_USAGE_MAP_READ = 1;
const GPU_BUFFER_USAGE_COPY_SRC = 4;
const GPU_BUFFER_USAGE_COPY_DST = 8;
const GPU_BUFFER_USAGE_STORAGE = 128;
const GPU_MAP_MODE_READ = 1;

function expectedValue(index: number, iterations: number): number {
  let value = (index + 1) >>> 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
  }
  return value;
}

function shader(config: BenchmarkWorkloadConfig): string {
  return `
@group(0) @binding(0) var<storage, read_write> values: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= ${config.elementCount}u) { return; }
  var value = index + 1u;
  for (var i = 0u; i < ${config.iterations}u; i = i + 1u) {
    value = value * 1664525u + 1013904223u;
  }
  values[index] = value;
}`;
}

function classifyFailure(error: unknown): "out_of_memory" | "device_lost" | "worker_failed" {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("memory") || message.includes("oom")) return "out_of_memory";
  if (message.includes("device") && message.includes("lost")) return "device_lost";
  return "worker_failed";
}

export async function runWebGpuBenchmarkWorkload(
  config: BenchmarkWorkloadConfig,
  signal: AbortSignal,
  environment: WebGpuEnvironment
): Promise<BenchmarkWorkloadOutcome> {
  const gpu = environment.navigator.gpu;
  if (!gpu) return { ok: false, error: { errorCode: "webgpu_unavailable" } };
  if (signal.aborted) return { ok: false, error: { errorCode: "cancelled" } };

  const initStartedAt = environment.now();
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return { ok: false, error: { errorCode: "adapter_request_failed" } };
  const device = await adapter.requestDevice().catch(() => null);
  if (!device) return { ok: false, error: { errorCode: "device_request_failed" } };

  const size = config.elementCount * Uint32Array.BYTES_PER_ELEMENT;
  const buffers: Array<{ destroy(): void }> = [];
  let readBuffer: ReturnType<typeof device.createBuffer> | null = null;
  let mapped = false;
  try {
    const module = device.createShaderModule({ code: shader(config) });
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const storage = device.createBuffer({ size, usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_SRC });
    readBuffer = device.createBuffer({ size, usage: GPU_BUFFER_USAGE_MAP_READ | GPU_BUFFER_USAGE_COPY_DST });
    buffers.push(storage, readBuffer);
    const bindGroup = environment.createBindGroup(device, pipeline.getBindGroupLayout(0), storage);
    const initMs = environment.now() - initStartedAt;

    const execute = async (validate: boolean): Promise<number> => {
      if (signal.aborted) throw new Error("cancelled");
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(config.elementCount / 64));
      pass.end();
      encoder.copyBufferToBuffer(storage, 0, readBuffer!, 0, size);
      const startedAt = environment.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const duration = environment.now() - startedAt;
      if (validate) {
        await readBuffer!.mapAsync(GPU_MAP_MODE_READ);
        mapped = true;
        const values = new Uint32Array(readBuffer!.getMappedRange());
        const indices = [0, Math.floor(config.elementCount / 2), config.elementCount - 1];
        const valid = indices.every((index) => values[index] === expectedValue(index, config.iterations));
        readBuffer!.unmap();
        mapped = false;
        if (!valid) throw new Error("invalid_compute_result");
      }
      return duration;
    };

    for (let i = 0; i < config.warmupCount; i += 1) await execute(false);
    const samplesMs: number[] = [];
    for (let i = 0; i < config.sampleCount; i += 1) samplesMs.push(await execute(i === config.sampleCount - 1));
    return { ok: true, value: { initMs, samplesMs, timingMethod: "wall-clock" } };
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.message === "cancelled")) {
      return { ok: false, error: { errorCode: "cancelled" } };
    }
    if (error instanceof Error && error.message === "invalid_compute_result") {
      return { ok: false, error: { errorCode: "invalid_compute_result" } };
    }
    return { ok: false, error: { errorCode: classifyFailure(error) } };
  } finally {
    if (mapped) readBuffer?.unmap();
    for (const buffer of buffers) buffer.destroy();
    device.destroy();
  }
}

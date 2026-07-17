import type { LocalBenchmarkErrorCode, StaticCapabilityProfile } from "@free-ai-open/types";

export interface BenchmarkWorkloadConfig {
  elementCount: number;
  iterations: number;
  warmupCount: number;
  sampleCount: number;
}

export interface BenchmarkWorkloadResult {
  initMs: number;
  samplesMs: number[];
  timingMethod: "wall-clock" | "gpu-timestamp";
}

export interface BenchmarkWorkloadFailure {
  errorCode: LocalBenchmarkErrorCode;
}

export type BenchmarkWorkloadOutcome =
  | { ok: true; value: BenchmarkWorkloadResult }
  | { ok: false; error: BenchmarkWorkloadFailure };

export type BenchmarkWorkloadExecutor = (
  config: BenchmarkWorkloadConfig,
  signal: AbortSignal
) => Promise<BenchmarkWorkloadOutcome>;

export interface RunLocalBenchmarkOptions {
  profile: StaticCapabilityProfile;
  executeWorkload: BenchmarkWorkloadExecutor;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => Date;
  performanceNow?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface WebGpuNavigatorLike {
  gpu?: { requestAdapter(): Promise<WebGpuAdapterLike | null> };
}

export interface WebGpuAdapterLike {
  requestDevice(): Promise<WebGpuDeviceLike>;
}

export interface WebGpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface WebGpuDeviceLike {
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipeline(descriptor: Record<string, unknown>): WebGpuPipelineLike;
  createBuffer(descriptor: { size: number; usage: number }): WebGpuBufferLike;
  createCommandEncoder(): WebGpuCommandEncoderLike;
  queue: { submit(commands: unknown[]): void; onSubmittedWorkDone(): Promise<void> };
  destroy(): void;
  lost?: Promise<{ reason?: string }>;
}

export interface WebGpuPipelineLike {
  getBindGroupLayout(index: number): unknown;
}

export interface WebGpuCommandEncoderLike {
  beginComputePass(): WebGpuComputePassLike;
  copyBufferToBuffer(source: WebGpuBufferLike, sourceOffset: number, target: WebGpuBufferLike, targetOffset: number, size: number): void;
  finish(): unknown;
}

export interface WebGpuComputePassLike {
  setPipeline(pipeline: WebGpuPipelineLike): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(count: number): void;
  end(): void;
}

export interface WebGpuEnvironment {
  navigator: WebGpuNavigatorLike;
  now(): number;
  createBindGroup(device: WebGpuDeviceLike, layout: unknown, buffer: WebGpuBufferLike): unknown;
}

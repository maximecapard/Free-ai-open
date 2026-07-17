import { runWebGpuBenchmarkWorkload } from "@free-ai-open/local-benchmark";
import type { BenchmarkWorkloadConfig, WebGpuEnvironment } from "@free-ai-open/local-benchmark";

interface WorkerRequest {
  id: string;
  config: BenchmarkWorkloadConfig;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const controller = new AbortController();
  const environment: WebGpuEnvironment = {
    navigator: navigator as unknown as WebGpuEnvironment["navigator"],
    now: () => performance.now(),
    createBindGroup: (device, layout, buffer) =>
      (device as unknown as { createBindGroup(descriptor: unknown): unknown }).createBindGroup({
        layout,
        entries: [{ binding: 0, resource: { buffer } }],
      }),
  };
  const outcome = await runWebGpuBenchmarkWorkload(event.data.config, controller.signal, environment);
  self.postMessage({ id: event.data.id, outcome });
};

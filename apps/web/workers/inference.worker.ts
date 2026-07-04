// WebLLM runtime is initialized here, not in a Server Component.
// This worker is the boundary for heavy browser inference work.
import { createInferenceWorkerHandler } from "@free-ai-open/ai-runtime";

const handler = createInferenceWorkerHandler();

self.onmessage = handler.onmessage.bind(handler);

export {};

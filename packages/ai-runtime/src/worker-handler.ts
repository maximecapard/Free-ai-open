import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// Must only be called from inside a Web Worker, never from a Server Component.
export function createInferenceWorkerHandler(): WebWorkerMLCEngineHandler {
  return new WebWorkerMLCEngineHandler();
}

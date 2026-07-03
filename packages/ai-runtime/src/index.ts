export interface RuntimeStatus {
  backend: "webgpu" | "wasm" | "cpu" | "unknown";
  modelId?: string;
  ready: boolean;
}

export interface GenerateInput {
  conversationId: string;
  prompt: string;
  modelId: string;
}

export interface GenerateChunk {
  type: "token" | "done" | "error";
  text?: string;
  errorCode?: string;
}

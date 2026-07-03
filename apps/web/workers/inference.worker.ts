// WebLLM runtime should be initialized here, not in a Server Component.
// Keep this worker as the boundary for heavy browser inference work.

self.onmessage = async (event: MessageEvent) => {
  const { type } = event.data ?? {};

  if (type === "PING") {
    self.postMessage({ type: "PONG" });
  }
};

export {};

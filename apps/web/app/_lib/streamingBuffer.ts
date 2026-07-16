export const STREAM_RENDER_INTERVAL_MS = 80;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface StreamingTextBufferOptions {
  intervalMs?: number;
  onFlush: (text: string) => void;
  setTimeoutFn?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
}

export interface StreamingTextBuffer {
  append: (text: string) => void;
  flush: () => void;
  dispose: (options?: { flushPending?: boolean }) => void;
}

export function createStreamingTextBuffer({
  intervalMs = STREAM_RENDER_INTERVAL_MS,
  onFlush,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}: StreamingTextBufferOptions): StreamingTextBuffer {
  let pendingText = "";
  let pendingTimer: TimerHandle | null = null;

  function clearTimer() {
    if (pendingTimer === null) return;
    clearTimeoutFn(pendingTimer);
    pendingTimer = null;
  }

  function flush() {
    clearTimer();
    if (!pendingText) return;

    const text = pendingText;
    pendingText = "";
    onFlush(text);
  }

  function scheduleFlush() {
    if (pendingTimer !== null) return;
    pendingTimer = setTimeoutFn(() => {
      pendingTimer = null;
      if (!pendingText) return;

      const text = pendingText;
      pendingText = "";
      onFlush(text);
    }, intervalMs);
  }

  return {
    append(text: string) {
      if (!text) return;
      pendingText += text;
      scheduleFlush();
    },
    flush,
    dispose(options: { flushPending?: boolean } = {}) {
      if (options.flushPending === false) {
        clearTimer();
        pendingText = "";
        return;
      }

      flush();
    },
  };
}

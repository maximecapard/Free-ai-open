// A generation's watchdog has exactly two phases, and both mean the same
// thing: "no runtime progress for the configured inactivity window." The
// only difference is which reference point the window is measured from —
// generation start (before any token has ever arrived) or the last received
// token/chunk (once streaming has begun). Total elapsed generation duration
// never enters this decision: a generation that keeps producing chunks can
// run indefinitely without either phase ever firing. See runtime.ts's
// separate, much larger ABSOLUTE_GENERATION_SAFETY_LIMIT_MS for the
// deliberately distinct emergency duration cap.
export type GenerationWatchdogPhase = "awaiting_first_token" | "streaming" | "disposed";

export interface GenerationWatchdogSnapshot {
  generationId: string;
  phase: GenerationWatchdogPhase;
  startedAt: number;
  firstProgressAt: number | null;
  lastProgressAt: number | null;
}

export interface GenerationWatchdogOptions {
  generationId: string;
  firstTokenTimeoutMs: number;
  stallTimeoutMs: number;
  onFirstTokenTimeout: () => void;
  onStallTimeout: () => void;
  now?: () => number;
  setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
}

export interface GenerationWatchdog {
  // Called on every raw progress signal (a non-empty token/chunk, or an
  // explicit runtime heartbeat). Whitespace/punctuation-only chunks still
  // count. Never called with rendered/buffered UI state — only real runtime
  // signals should reach this.
  recordProgress(): void;
  // Stops counting inactivity without declaring a timeout. Used while the
  // document is hidden, since background tab throttling can delay timer
  // firing and message delivery in ways that look like inactivity but
  // aren't. Safe to call repeatedly.
  suspend(): void;
  // Resumes with a full fresh inactivity window from now, rather than
  // continuing a countdown that may have started before the tab was
  // hidden — this gives any progress that was queued while backgrounded a
  // chance to arrive and be recorded before a stall could be declared.
  resume(): void;
  // Permanently stops the watchdog (generation completed, was cancelled,
  // errored, or the runtime was replaced/torn down). No callback fires
  // after this, even if a check was already in flight.
  dispose(): void;
  getSnapshot(): GenerationWatchdogSnapshot;
}

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function createGenerationWatchdog({
  generationId,
  firstTokenTimeoutMs,
  stallTimeoutMs,
  onFirstTokenTimeout,
  onStallTimeout,
  now = defaultNow,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}: GenerationWatchdogOptions): GenerationWatchdog {
  const startedAt = now();
  let firstProgressAt: number | null = null;
  let lastProgressAt: number | null = null;
  let phase: GenerationWatchdogPhase = "awaiting_first_token";
  let suspended = false;
  let timerHandle: ReturnType<typeof setTimeoutFn> | null = null;

  function clearTimer(): void {
    if (timerHandle !== null) {
      clearTimeoutFn(timerHandle);
      timerHandle = null;
    }
  }

  function scheduleCheck(delayMs: number): void {
    clearTimer();
    timerHandle = setTimeoutFn(runCheck, Math.max(delayMs, 0));
  }

  // The core "robust watchdog" step: a fired timer is only ever a *hint*
  // that inactivity might have elapsed, never proof. It always recomputes
  // real elapsed time against the latest recorded progress before acting,
  // so a delayed event loop (a busy main thread, throttled background
  // timers, GC pauses) firing this callback late can never cause a false
  // positive — it just re-arms for whatever time is actually left.
  function runCheck(): void {
    timerHandle = null;
    if (phase === "disposed" || suspended) return;

    if (phase === "awaiting_first_token") {
      const elapsed = now() - startedAt;
      if (elapsed < firstTokenTimeoutMs) {
        scheduleCheck(firstTokenTimeoutMs - elapsed);
        return;
      }
      phase = "disposed";
      onFirstTokenTimeout();
      return;
    }

    const reference = lastProgressAt ?? startedAt;
    const elapsed = now() - reference;
    if (elapsed < stallTimeoutMs) {
      scheduleCheck(stallTimeoutMs - elapsed);
      return;
    }
    phase = "disposed";
    onStallTimeout();
  }

  scheduleCheck(firstTokenTimeoutMs);

  return {
    recordProgress() {
      if (phase === "disposed") return;
      const progressAt = now();
      if (firstProgressAt === null) firstProgressAt = progressAt;
      lastProgressAt = progressAt;
      phase = "streaming";
    },
    suspend() {
      if (phase === "disposed" || suspended) return;
      suspended = true;
      clearTimer();
    },
    resume() {
      if (phase === "disposed" || !suspended) return;
      suspended = false;
      scheduleCheck(phase === "awaiting_first_token" ? firstTokenTimeoutMs : stallTimeoutMs);
    },
    dispose() {
      phase = "disposed";
      clearTimer();
    },
    getSnapshot(): GenerationWatchdogSnapshot {
      return { generationId, phase, startedAt, firstProgressAt, lastProgressAt };
    },
  };
}

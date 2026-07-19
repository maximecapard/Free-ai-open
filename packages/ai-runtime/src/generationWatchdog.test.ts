import { describe, expect, it, vi } from "vitest";
import { createGenerationWatchdog } from "./generationWatchdog";

interface ScheduledEntry {
  id: number;
  callback: () => void;
  fireAt: number;
}

// A manually-driven fake clock/timer pair, distinct from vi.useFakeTimers():
// it lets a test advance the clock and invoke a scheduled callback as two
// fully independent steps, so a callback can be run "late" relative to its
// nominal fire time while precisely controlling what now() reports at that
// moment. That is exactly the scenario generationWatchdog.ts's recompute
// logic exists to handle, so the tests need to be able to construct it
// directly rather than relying on real/simulated timer firing order alone.
function createFakeClock(initial = 0) {
  let currentTime = initial;
  const scheduled: ScheduledEntry[] = [];
  let nextId = 1;

  function now(): number {
    return currentTime;
  }

  function setTimeoutFn(callback: () => void, delayMs: number): number {
    const id = nextId++;
    scheduled.push({ id, callback, fireAt: currentTime + delayMs });
    return id;
  }

  function clearTimeoutFn(handle: number): void {
    const index = scheduled.findIndex((entry) => entry.id === handle);
    if (index !== -1) scheduled.splice(index, 1);
  }

  function advanceTo(time: number): void {
    currentTime = time;
  }

  // Fires every scheduled callback currently due (fireAt <= now), including
  // ones newly scheduled by an already-fired callback in the same pass —
  // matching how a real timer queue would keep draining due work.
  function runDue(): void {
    let ranSomething = true;
    while (ranSomething) {
      ranSomething = false;
      const dueIndex = scheduled.findIndex((entry) => entry.fireAt <= currentTime);
      if (dueIndex !== -1) {
        const [entry] = scheduled.splice(dueIndex, 1);
        entry.callback();
        ranSomething = true;
      }
    }
  }

  return {
    now,
    setTimeoutFn: setTimeoutFn as unknown as (cb: () => void, ms: number) => ReturnType<typeof setTimeout>,
    clearTimeoutFn: clearTimeoutFn as unknown as (handle: ReturnType<typeof setTimeout>) => void,
    advanceTo,
    runDue,
    pendingCount: () => scheduled.length,
  };
}

function watchdogHarness(overrides: { firstTokenTimeoutMs?: number; stallTimeoutMs?: number } = {}) {
  const clock = createFakeClock();
  const onFirstTokenTimeout = vi.fn();
  const onStallTimeout = vi.fn();
  const watchdog = createGenerationWatchdog({
    generationId: "gen-1",
    firstTokenTimeoutMs: overrides.firstTokenTimeoutMs ?? 1_000,
    stallTimeoutMs: overrides.stallTimeoutMs ?? 1_000,
    onFirstTokenTimeout,
    onStallTimeout,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });
  return { clock, onFirstTokenTimeout, onStallTimeout, watchdog };
}

describe("createGenerationWatchdog", () => {
  it("does not fire before the first-token threshold has elapsed", () => {
    const { clock, onFirstTokenTimeout, onStallTimeout } = watchdogHarness();
    clock.advanceTo(999);
    clock.runDue();
    expect(onFirstTokenTimeout).not.toHaveBeenCalled();
    expect(onStallTimeout).not.toHaveBeenCalled();
  });

  it("fires the first-token timeout when no progress ever arrives", () => {
    const { clock, onFirstTokenTimeout, onStallTimeout } = watchdogHarness();
    clock.advanceTo(1_000);
    clock.runDue();
    expect(onFirstTokenTimeout).toHaveBeenCalledTimes(1);
    expect(onStallTimeout).not.toHaveBeenCalled();
  });

  it("permanently clears the first-token phase once the first chunk arrives", () => {
    const { clock, watchdog, onFirstTokenTimeout, onStallTimeout } = watchdogHarness();
    clock.advanceTo(500);
    watchdog.recordProgress();

    // The check originally armed at generation start for the first-token
    // threshold is still scheduled for t=1000; it must not fire the
    // first-token callback now that a token has arrived.
    clock.advanceTo(1_000);
    clock.runDue();
    expect(onFirstTokenTimeout).not.toHaveBeenCalled();
    expect(onStallTimeout).not.toHaveBeenCalled();
    expect(watchdog.getSnapshot().phase).toBe("streaming");
  });

  it("recomputes elapsed time against lastProgressAt across multiple self-corrections instead of firing on a stale schedule", () => {
    const { clock, watchdog, onFirstTokenTimeout, onStallTimeout } = watchdogHarness({
      firstTokenTimeoutMs: 1_000,
      stallTimeoutMs: 1_000,
    });

    clock.advanceTo(900);
    watchdog.recordProgress(); // first token, close to the original deadline

    // The stale check scheduled at t=1000 fires; real elapsed since progress
    // is only 100ms, well under the stall threshold, so it must re-arm
    // instead of declaring a stall.
    clock.advanceTo(1_000);
    clock.runDue();
    expect(onStallTimeout).not.toHaveBeenCalled();

    clock.advanceTo(1_850);
    watchdog.recordProgress(); // another chunk, again close to the re-armed deadline (t=1900)

    clock.advanceTo(1_900);
    clock.runDue();
    expect(onStallTimeout).not.toHaveBeenCalled();

    // Now genuinely stop producing progress. The next self-armed check
    // (t=2850) must actually fire once 1000ms of real inactivity elapses.
    clock.advanceTo(2_850);
    clock.runDue();
    expect(onStallTimeout).toHaveBeenCalledTimes(1);
    expect(onFirstTokenTimeout).not.toHaveBeenCalled();
  });

  it("does not falsely declare a stall when a timer callback fires late but progress happened before it fired", () => {
    const { clock, watchdog, onStallTimeout } = watchdogHarness({ firstTokenTimeoutMs: 100, stallTimeoutMs: 1_000 });

    clock.advanceTo(0);
    watchdog.recordProgress(); // immediate first token

    // The check armed at start (for the 100ms first-token window) is still
    // pending; real progress arrives at t=950, comfortably inside the
    // 1000ms stall window measured from t=0.
    clock.advanceTo(950);
    watchdog.recordProgress();

    // The underlying event loop is simulated as delayed: the callback that
    // was nominally due earlier only actually runs once now() reaches 1500,
    // 550ms "late". Recomputing against the real lastProgressAt (950) shows
    // only 550ms of true inactivity, under the 1000ms threshold.
    clock.advanceTo(1_500);
    clock.runDue();
    expect(onStallTimeout).not.toHaveBeenCalled();

    // Real inactivity finally exceeds the threshold.
    clock.advanceTo(1_950);
    clock.runDue();
    expect(onStallTimeout).toHaveBeenCalledTimes(1);
  });

  it("detects a genuine gap shorter than the threshold as not stalled, and a gap at/after the threshold as stalled", () => {
    const short = watchdogHarness({ firstTokenTimeoutMs: 50, stallTimeoutMs: 1_000 });
    short.clock.advanceTo(0);
    short.watchdog.recordProgress();
    short.clock.advanceTo(999);
    short.clock.runDue();
    expect(short.onStallTimeout).not.toHaveBeenCalled();

    const exact = watchdogHarness({ firstTokenTimeoutMs: 50, stallTimeoutMs: 1_000 });
    exact.clock.advanceTo(0);
    exact.watchdog.recordProgress();
    exact.clock.advanceTo(1_000);
    exact.clock.runDue();
    expect(exact.onStallTimeout).toHaveBeenCalledTimes(1);
  });

  it("suspend stops the countdown even past the configured threshold", () => {
    const { clock, watchdog, onFirstTokenTimeout } = watchdogHarness();
    clock.advanceTo(10);
    watchdog.suspend();
    expect(clock.pendingCount()).toBe(0);

    clock.advanceTo(50_000);
    clock.runDue();
    expect(onFirstTokenTimeout).not.toHaveBeenCalled();
  });

  it("resume grants a full fresh inactivity window rather than continuing a stale countdown", () => {
    const { clock, watchdog, onFirstTokenTimeout } = watchdogHarness({ firstTokenTimeoutMs: 1_000 });
    clock.advanceTo(10);
    watchdog.suspend();

    // Backgrounded for a long time, then foregrounded again.
    clock.advanceTo(5_000);
    watchdog.resume();

    // A stale countdown (990ms remaining from the original 1000ms window)
    // would fire here; a fresh window must not.
    clock.advanceTo(5_990);
    clock.runDue();
    expect(onFirstTokenTimeout).not.toHaveBeenCalled();

    clock.advanceTo(6_000);
    clock.runDue();
    expect(onFirstTokenTimeout).toHaveBeenCalledTimes(1);
  });

  it("resume in the streaming phase re-arms using the stall threshold, not the first-token threshold", () => {
    const { clock, watchdog, onStallTimeout } = watchdogHarness({ firstTokenTimeoutMs: 50, stallTimeoutMs: 1_000 });
    clock.advanceTo(0);
    watchdog.recordProgress();
    clock.advanceTo(10);
    watchdog.suspend();

    clock.advanceTo(2_000);
    watchdog.resume();

    clock.advanceTo(2_999);
    clock.runDue();
    expect(onStallTimeout).not.toHaveBeenCalled();

    clock.advanceTo(3_000);
    clock.runDue();
    expect(onStallTimeout).toHaveBeenCalledTimes(1);
  });

  it("dispose prevents any further callback from ever firing", () => {
    const { clock, watchdog, onFirstTokenTimeout, onStallTimeout } = watchdogHarness();
    clock.advanceTo(10);
    watchdog.dispose();
    expect(clock.pendingCount()).toBe(0);

    clock.advanceTo(100_000);
    clock.runDue();
    expect(onFirstTokenTimeout).not.toHaveBeenCalled();
    expect(onStallTimeout).not.toHaveBeenCalled();
  });

  it("ignores recordProgress after dispose", () => {
    const { clock, watchdog } = watchdogHarness();
    clock.advanceTo(10);
    watchdog.dispose();
    clock.advanceTo(20);
    watchdog.recordProgress();

    const snapshot = watchdog.getSnapshot();
    expect(snapshot.phase).toBe("disposed");
    expect(snapshot.lastProgressAt).toBeNull();
  });

  it("exposes generationId, phase, and timestamps for external inspection", () => {
    const { clock, watchdog } = watchdogHarness();
    expect(watchdog.getSnapshot()).toEqual({
      generationId: "gen-1",
      phase: "awaiting_first_token",
      startedAt: 0,
      firstProgressAt: null,
      lastProgressAt: null,
    });

    clock.advanceTo(42);
    watchdog.recordProgress();
    expect(watchdog.getSnapshot()).toMatchObject({
      phase: "streaming",
      firstProgressAt: 42,
      lastProgressAt: 42,
    });
  });
});

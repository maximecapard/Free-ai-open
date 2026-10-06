import type { ModelBenchmarkContextPreset } from "@free-ai-open/types";

// The fixed, versioned, local-only workload the v0.8 "quick" benchmark
// preset runs. Not a secret: this text is not user-sensitive data, so no
// security boundary is built around it (see docs/security.md's Phase 2
// section for the honest framing). What actually matters, and IS enforced,
// is narrower: it is never written to a persisted ModelBenchmarkResult,
// never written to a local log or diagnostic report, and never surfaced on
// ModelBenchmarkRunnerState -- see runner.ts, which reads it only via
// getQuickBenchmarkPrompt() at the one call site that feeds
// runtime.generate(). It is not re-exported from this package's public
// index.ts, matching this package's existing "narrow public surface"
// convention -- not because the string is secret, but because nothing
// outside the runner has a legitimate reason to read it.
//
// Fixed and versioned rather than randomly generated or sourced from any
// conversation/user content: two runs of the same benchmarkVersion, on the
// same model, must exercise the identical workload to be comparable at all
// (see the mission's own "stable enough to compare repeated runs"
// requirement). Bump MODEL_BENCHMARK_VERSION in constants.ts -- never this
// file alone -- if this text or any preset limit below ever changes in a way
// that would make historical results incomparable to newly-measured ones.
const QUICK_BENCHMARK_PROMPT =
  "Write a short, three-sentence paragraph, in plain language, explaining why " +
  "keeping a brief daily journal can help someone notice patterns in their own mood over time. " +
  "Do not use any lists or headings -- plain prose only.";

export function getQuickBenchmarkPrompt(): string {
  return QUICK_BENCHMARK_PROMPT;
}

// v0.8 "quick" preset's own finite limits -- see benchmark-signals.ts's
// modelBenchmarkPresets ("quick" is the only one this phase actually ships a
// runner for; "standard"/"extended" remain reserved contract values with no
// runner support yet). Every limit here is a genuine, finite upper bound
// (the mission's own "all limits must be finite" rule).
//
// `outputTokens` is used for BOTH the persisted `runConfig.requestedOutputTokens`
// AND the actual `maxOutputTokens` passed to `runtime.generate()` -- a
// single value, never two independently-drifting ones. An earlier draft of
// this preset persisted 128 while actually requesting 256 from the runtime;
// that was corrected by removing the second value entirely rather than
// keeping a "hard ceiling vs. requested amount" split this phase has no use
// for (see runner.ts's own call site).
//
// Deliberately much tighter than @free-ai-open/ai-runtime's own internal
// generation watchdog (FIRST_TOKEN_TIMEOUT_MS/STALL_TIMEOUT_MS = 45s each,
// ABSOLUTE_GENERATION_SAFETY_LIMIT_MS = 600s -- see runtime.ts): those exist
// as a generous, rarely-tripped safety net for real chat generations across
// arbitrarily long conversations, while a "quick" benchmark run is a small,
// fixed workload that should either respond promptly or be classified
// (neutrally -- see ModelBenchmarkOutcome's own doc comment on
// "benchmark_timeout") well before ai-runtime's own emergency limits would
// ever fire. ai-runtime's internal watchdog remains untouched, unmodified,
// and still active underneath as the outer net it already was for every
// other caller.
export interface ModelBenchmarkPresetLimits {
  contextPreset: ModelBenchmarkContextPreset;
  contextWindowTokens: number;
  outputTokens: number;
  loadTimeoutMs: number;
  firstTokenTimeoutMs: number;
  stallTimeoutMs: number;
  absoluteBenchmarkTimeoutMs: number;
}

export const QUICK_MODEL_BENCHMARK_PRESET: ModelBenchmarkPresetLimits = {
  contextPreset: "balanced",
  contextWindowTokens: 2048,
  outputTokens: 128,
  loadTimeoutMs: 60_000,
  firstTokenTimeoutMs: 20_000,
  stallTimeoutMs: 15_000,
  absoluteBenchmarkTimeoutMs: 60_000,
};

// How much longer the runner will keep waiting for runtime.generate()'s
// async iteration to actually yield a terminal chunk AFTER the runner has
// already called runtime.stopGeneration() in response to one of the
// timeouts above -- covers ai-runtime's own cancel-confirmation window
// (CANCEL_TIMEOUT_MS = 15s in runtime.ts) with comfortable margin. If even
// this hard outer bound is exceeded (a truly wedged worker that never
// confirms interruption), the runner gives up waiting on the generator
// entirely rather than hanging indefinitely -- see runner.ts's own
// "teardown grace" handling. This is a fixed subsystem addition that
// still clamps to the shared automated-burst deadline below. Its
// purpose is to give the runtime extra time to confirm a timeout when the
// burst still has that budget, never to extend the overall burst.
export const GENERATION_TEARDOWN_GRACE_MS = 20_000;

// Per-step cap for each of the four "checking" steps the runner performs
// before (and again, freshly, after consent is confirmed): trusted model
// resolution, the trusted environment snapshot, hard eligibility
// evaluation, and the informational cache check. Each is an
// injected/caller-supplied async function this package does not control,
// so none may be allowed to hang forever.
export const TRUSTED_LOOKUP_STEP_TIMEOUT_MS = 15_000;

// Bounds the injected recoverRuntime() callback (see runner.ts's "Runtime
// recovery" handling) -- called only when the shared runtime is left in a
// non-idle/non-ready state by the runner's own cancellation/timeout/failure
// handling, before the runner persists its result.
export const RUNTIME_RECOVERY_TIMEOUT_MS = 10_000;

// Bounds the final store.recordResult() write.
export const PERSISTENCE_TIMEOUT_MS = 5_000;

// How long the runner waits, AFTER aborting a timed-out injected operation,
// for that operation to confirm it actually stopped. This is deliberately a
// BOUNDED confirmation window rather than "await the promise forever": a
// dependency that ignores its AbortSignal must never be able to hold the
// runner hostage indefinitely. When the window elapses the operation is
// ABANDONED -- its quiescence can no longer be proven -- and the runner fails
// closed. What that means depends on WHICH domain the operation belongs to:
//
// - an abandoned runtime recovery (RUNTIME_RECOVERY_ABORT_GRACE_MS) means the
//   old worker domain was never shown to be isolated, so the runtime lease is
//   QUARANTINED (never released) and the run ends with
//   runtime_isolation_failed;
// - an abandoned persistence write (PERSISTENCE_ABORT_GRACE_MS) is a STORAGE
//   fact only. Persistence runs AFTER the runtime lease has been released
//   (the runtime work is finalized first), so it never holds or quarantines
//   the shared runtime / RuntimeOperationCoordinator, and chat/runtime use
//   stays available. The run ends with persistence_isolation_failed, and only
//   a NEW benchmark run is refused (persistence_unsettled) until that write
//   eventually settles. Only a trusted, package-owned store can reach this
//   path, and only by breaking its own cancellation contract (see
//   trusted-store.ts).
//
// A RUNTIME quarantine is lifted only by an explicit isolation retry in the
// composing app (see ai-runtime's
// RuntimeOperationCoordinator.clearQuarantine()).
export const RUNTIME_RECOVERY_ABORT_GRACE_MS = 3_000;
export const PERSISTENCE_ABORT_GRACE_MS = 2_000;

// The total time budget for ONE contiguous burst of automated work: either
// (a) start() through to either "requires_model_load_consent" or
// "completed"/"failed", or (b) confirmConsent() through to
// "completed"/"failed" (a fresh budget -- time spent PARKED waiting for a
// human to grant or decline consent is never counted against it; see
// runner.ts's own comment on why). Every individually-bounded step above
// additionally clamps its own timeout to whatever remains of this shared
// deadline ("remaining-deadline budgeting"), so no combination of
// individually-reasonable step timeouts can silently add up past this
// total. With the production constants the worst case of every step run back
// to back is 4 x 15s checking steps (60s, though only one is ever expected to
// actually be slow) + 60s load + 60s absolute generation timeout + 20s
// teardown grace + 13s recovery window (10s + 3s abort grace) + 7s
// persistence window (5s + 2s abort grace) = exactly 220s, so every
// individually-bounded window fits inside this budget.
//
// The deadline clamps WORK steps (checks, load, generation, persistence).
// The mandatory isolation windows -- the recovery window and the two abort-
// settlement graces above -- are fixed constants that are deliberately NOT
// clamped to zero when the budget is spent: recovery is what proves the old
// runtime work is isolated, so it must not be skipped merely because the
// budget ran out. The only way to exceed TOTAL_AUTOMATED_BUDGET_MS is
// therefore a configuration whose budget is smaller than the production
// sum (tests); the proven ceiling in every configuration is
// MAX_AUTOMATED_BURST_MS below. No external await can hang the runner
// beyond that, because every wait on an injected dependency is a timer race
// followed by an at-most-bounded abort-settlement window -- never an
// unbounded `await promise`.
export const TOTAL_AUTOMATED_BUDGET_MS = 220_000;

// Proven upper bound on one automated burst for a given work budget: the
// work budget plus the fixed, un-clampable isolation windows.
export function maxAutomatedBurstMs(
  workBudgetMs: number = TOTAL_AUTOMATED_BUDGET_MS,
): number {
  return (
    workBudgetMs +
    RUNTIME_RECOVERY_TIMEOUT_MS +
    RUNTIME_RECOVERY_ABORT_GRACE_MS +
    PERSISTENCE_ABORT_GRACE_MS
  );
}

// v0.8.0-alpha "Local Benchmarks & Performance Intelligence" -- Phase 2: a
// real, bounded, cancellable, local MODEL benchmark runner built on top of
// Phase 0's persisted contracts (@free-ai-open/types' ModelBenchmarkResult,
// this package's own sanitizeModelBenchmarkResult()/ModelBenchmarkStoreClient)
// and Phase 1's runtime-backed metrics (@free-ai-open/ai-runtime's
// GenerationRuntimeMetrics/ModelLoadRuntimeMetrics). This is orchestration
// only: it never builds the /benchmarks UI and never wires evidence into
// router scoring -- see docs/roadmap.md.
//
// Trust boundary (see runner-trust.ts): the public start() input is a bare
// `modelId` string. Every other fact that ends up in a persisted
// ModelBenchmarkResult -- the model's WebLLM id/registry version/
// quantization/fingerprint, and the current browserFamily/
// capabilityProfileKey/performanceMode/appVersion -- comes from REQUIRED
// injected dependencies (a TrustedBenchmarkTargetResolver and a
// TrustedBenchmarkEnvironmentProvider) this package does not implement
// itself. A structurally-valid-looking caller-supplied object is never
// treated as equivalent to a verified one.
//
// Ownership model: the runner never creates its own worker/engine. It
// accepts an INJECTED InferenceRuntime and uses the generic coordinator
// associated with that runtime by @free-ai-open/ai-runtime. The benchmark
// acquires a lease immediately before any load/generation and holds it
// through runtime recovery, then releases it once the runtime work is
// finalized (isolated) -- BEFORE persistence, which is storage-only and never
// owns the shared runtime. A lease that cannot prove isolation is quarantined
// instead of released. Normal chat generation and app model switching use
// the same coordinator, so a runtime-state snapshot is never mistaken for
// concurrency control.
//
// Persistence trust: the runner only accepts a ModelBenchmarkStoreClient this
// package created (see trusted-store.ts), because its no-late-write
// guarantee is a property of those implementations' cancellation semantics,
// not of any TypeScript shape.
//
// Model restoration policy: this core service leaves the benchmark target
// loaded. Phase 3 app composition must reconcile that loaded model with the
// router/manual selection before presenting the runtime as coherent for the
// next chat operation. The result identifies the benchmarked model, while
// runtime recovery/finalization is a separate mandatory dependency.
import {
  INSTALLED_WEBLLM_VERSION,
  getRuntimeOperationCoordinator,
  isModelCached,
  normalizeRuntimeRecoveryResult,
} from "@free-ai-open/ai-runtime";
import type {
  GenerateChunk,
  GenerationRuntimeMetrics,
  InferenceRuntime,
  RuntimeError,
  RuntimeErrorCode,
  RuntimeOperationLease,
  RuntimeRecoveryResult,
} from "@free-ai-open/ai-runtime";
import type {
  ModelBenchmarkFirstTokenMeasurement,
  ModelBenchmarkGenerationMeasurement,
  ModelBenchmarkLoadMeasurement,
  ModelBenchmarkOutcome,
  ModelBenchmarkResult,
  ModelBenchmarkStage,
} from "@free-ai-open/types";
import { ModelBenchmarkStoreClient } from "./client";
import { isTrustedStoreClient } from "./trusted-store";
import {
  MODEL_BENCHMARK_SCHEMA_VERSION,
  MODEL_BENCHMARK_VERSION,
} from "./constants";
import { calculateModelBenchmarkExpiry } from "./expiry";
import {
  GENERATION_TEARDOWN_GRACE_MS,
  PERSISTENCE_ABORT_GRACE_MS,
  PERSISTENCE_TIMEOUT_MS,
  QUICK_MODEL_BENCHMARK_PRESET,
  RUNTIME_RECOVERY_ABORT_GRACE_MS,
  RUNTIME_RECOVERY_TIMEOUT_MS,
  TOTAL_AUTOMATED_BUDGET_MS,
  TRUSTED_LOOKUP_STEP_TIMEOUT_MS,
  getQuickBenchmarkPrompt,
} from "./runner-workload";
import type {
  BenchmarkEligibilityEvaluator,
  BenchmarkEligibilityResult,
  TrustedBenchmarkEnvironmentProvider,
  TrustedBenchmarkEnvironmentSnapshot,
  TrustedBenchmarkTarget,
  TrustedBenchmarkTargetResolver,
} from "./runner-trust";
import { trustedBenchmarkTargetsEqual } from "./runner-trust";
import {
  sanitizeModelReference,
  sanitizeTrustedBenchmarkEnvironment,
} from "./validation";

// A fixed, obviously-synthetic conversationId for every benchmark-triggered
// generate() call -- never a real conversation. This is metadata only (it
// reaches ai-runtime's own log events as a plain identifier, never content),
// so a fixed sentinel is sufficient and, unlike a random id, makes benchmark
// activity easy to tell apart from real chat activity in local logs.
const BENCHMARK_CONVERSATION_ID = "model-benchmark";

// The only two stages a real generation measurement can exist for -- mirrors
// validation.ts's own STAGES_WITH_FIRST_TOKEN/STAGES_WITH_GENERATION
// exactly (both happen to be the identical two stages there), duplicated
// here as its own small literal rather than exported/imported, matching
// this codebase's existing convention of small local allowlists.
const STAGES_WITH_MEASUREMENTS = new Set<ModelBenchmarkStage>([
  "generating",
  "complete",
]);

export type ModelBenchmarkRunnerStatus =
  | "idle"
  | "checking"
  | "requires_model_load_consent"
  | "loading"
  | "running"
  | "cancelling"
  | "recovering"
  | "persisting"
  | "completed"
  | "failed";

export type ModelBenchmarkRunnerErrorCode =
  | "unknown_model"
  | "ineligible_model"
  | "environment_unavailable"
  | "invalid_consent"
  | "consent_stale"
  | "runtime_busy"
  | "benchmark_already_running"
  | "persistence_failed"
  | "target_resolver_failed"
  | "environment_provider_failed"
  | "eligibility_failed"
  | "cache_inspection_failed"
  // The old runtime work was recovered/replaced SAFELY (isolated) but no
  // usable runtime came back. Ownership was released.
  | "runtime_recovery_failed"
  // The old runtime work could NOT be proven quiescent or physically
  // isolated (recovery reported isolated=false, was rejected, or ignored its
  // abort signal). Ownership is quarantined, never released.
  | "runtime_isolation_failed"
  // A previous run left the shared runtime quarantined; no benchmark may
  // start until the composing app lifts the quarantine.
  | "runtime_quarantined"
  // The result store did not stop its write after being aborted (it neither
  // settled nor failed within the bounded grace), so the write may still
  // commit. This is a STORAGE fact only: the runtime is never quarantined or
  // held for it. New benchmark runs are refused (`persistence_unsettled`)
  // until that write settles.
  | "persistence_isolation_failed"
  // An earlier run's persistence write has not settled yet, so a new benchmark
  // cannot start. Chat/runtime use is unaffected.
  | "persistence_unsettled"
  | "operation_timeout"
  | "runner_failed";

export interface ModelBenchmarkRunnerError {
  code: ModelBenchmarkRunnerErrorCode;
  message: string;
}

// A discriminated union, not a flat interface with optional fields: each
// variant carries exactly the data valid for that state, so a caller can
// never observe a stale `target`/`consentRequestId`/`result`/`error` left
// over from an earlier, unrelated attempt -- every transition below
// constructs a brand-new, complete state object rather than patch-merging
// onto the previous one.
export type ModelBenchmarkRunnerState =
  | { status: "idle" }
  | { status: "checking"; modelId: string }
  | {
      status: "requires_model_load_consent";
      modelId: string;
      consentRequestId: string;
    }
  | { status: "loading"; modelId: string }
  | { status: "running"; modelId: string }
  | { status: "cancelling"; modelId: string }
  | { status: "recovering"; modelId: string }
  | { status: "persisting"; modelId: string }
  | { status: "completed"; modelId: string; result: ModelBenchmarkResult }
  | {
      status: "failed";
      modelId?: string;
      error: ModelBenchmarkRunnerError;
      persistedResult?: ModelBenchmarkResult;
    };

// The ONLY caller-supplied input to start(): a bare model id. Every other
// fact a persisted result needs is derived through the trusted
// resolver/environment-provider/eligibility-evaluator dependencies below --
// see this file's own top comment and runner-trust.ts.
export interface ModelBenchmarkRunOptions {
  modelId: string;
}

export interface ModelBenchmarkRuntimeRecoveryContext {
  signal: AbortSignal;
  lease: RuntimeOperationLease;
}

// What a recovery adapter reports: TWO independent facts, never one boolean
// (see ai-runtime's RuntimeRecoveryResult). `isolated` -- the old runtime
// work is quiescent or physically isolated -- alone decides whether
// ownership may ever be released; `ready` -- a usable runtime exists again --
// only decides whether the run is reported as runtime_recovery_failed.
export type ModelBenchmarkRuntimeRecovery = RuntimeRecoveryResult;

export interface ModelBenchmarkRunnerOptions {
  runtime: InferenceRuntime;
  targetResolver: TrustedBenchmarkTargetResolver;
  environmentProvider: TrustedBenchmarkEnvironmentProvider;
  eligibilityEvaluator: BenchmarkEligibilityEvaluator;
  // Called whenever the runner's own cancellation/timeout/failure handling
  // leaves the shared runtime in a non-idle/non-ready state, before the
  // runner persists its result -- see this file's "Runtime recovery"
  // handling below. The adapter must honor `signal`, settle after abort, and
  // report `isolated: true` only once the timed-out/failed runtime operation
  // is quiescent or physically isolated (e.g. its worker confirmed
  // terminated). Fail-closed contract:
  //   - { isolated: true,  ready: true  }  -> the run proceeds normally, but
  //     only while the runtime really reports status "ready" ("idle" is not
  //     readiness); a claim the runtime contradicts fails closed as
  //     runtime_recovery_failed;
  //   - { isolated: true,  ready: false }  -> ownership is released, the run
  //     ends as runtime_recovery_failed;
  //   - { isolated: false, ... }, a rejection, a malformed/legacy boolean
  //     result, or ignoring `signal` past the bounded grace -> isolation is
  //     UNPROVEN: the lease is quarantined (never released) and the run ends
  //     as runtime_isolation_failed.
  // Already-valid benchmark evidence is still persisted in every case.
  recoverRuntime: (
    context: ModelBenchmarkRuntimeRecoveryContext,
  ) => Promise<ModelBenchmarkRuntimeRecovery>;
  // Injectable only for deterministic failure/race tests. Production uses
  // ai-runtime's local cache inspection helper.
  inspectModelCache?: (webllmModelId: string) => Promise<boolean> | boolean;
  // A client created by this package (default: the package's own client).
  // Anything else -- a structurally similar object, a forged prototype, a
  // Proxy, a subclass -- is refused at construction: see trusted-store.ts.
  store?: ModelBenchmarkStoreClient;
  // Overridable only for deterministic tests -- see docs/architecture.md's
  // "Benchmark clock handling" section. Only ever used for the persisted
  // point-in-time `createdAt` timestamp; every DURATION in a benchmark
  // result comes from @free-ai-open/ai-runtime's own measurements, never
  // recomputed from this clock.
  now?: () => Date;
  // Test-only override for deterministic deadline proofs. Production uses
  // TOTAL_AUTOMATED_BUDGET_MS.
  automatedBudgetMs?: number;
}

export interface ModelBenchmarkRunner {
  getState(): ModelBenchmarkRunnerState;
  subscribe(listener: (state: ModelBenchmarkRunnerState) => void): () => void;
  // Resolves once this attempt reaches a resting state: "requires_model_load_consent"
  // (call confirmConsent() with the returned consentRequestId, or cancel()),
  // "completed", or "failed". Never rejects -- every failure mode is
  // reported through the resolved state's own `error`.
  start(options: ModelBenchmarkRunOptions): Promise<ModelBenchmarkRunnerState>;
  // Advances a run parked at "requires_model_load_consent" PAST the load
  // step, but only if `consentRequestId` exactly matches the currently
  // pending request for the CURRENTLY active run -- a stale id (from a
  // cancelled/superseded/already-confirmed attempt) or one belonging to a
  // different run can never authorize this one. Re-resolves the trusted
  // target/environment/eligibility fresh before proceeding: if the model's
  // registry record changed since consent was requested, the stale consent
  // is rejected rather than silently honored against a different model.
  confirmConsent(consentRequestId: string): Promise<ModelBenchmarkRunnerState>;
  // Safe to call from any state; a no-op unless a benchmark is actually
  // in-flight.
  cancel(): void;
}

// Mutable per-attempt tracking, isolated to ONE run: a brand-new object is
// created for every start() call and discarded once that attempt reaches a
// terminal/idle state. Nothing here is a shared variable in the runner's own
// closure -- an abandoned background operation from a PREVIOUS, already-
// finalized run only ever holds a reference to ITS OWN (now-detached)
// RunContext, so it structurally cannot mutate a later run's bookkeeping,
// even if it settles long after that later run has started. Every function
// below reads/writes this object rather than a bare outer-scope variable,
// and checks `isCurrent(run)` after every `await` before acting on its
// result.
interface RunContext {
  readonly runId: number;
  readonly modelId: string;
  cancelRequested: boolean;
  stopTrigger: "none" | "caller_cancel" | "timeout";
  // Only the target is retained: confirmConsent() re-fetches the
  // environment/eligibility/cache state fully fresh (see performChecks())
  // rather than trusting anything cached from the moment consent was
  // requested, so only the ORIGINAL target needs to be kept around, purely
  // to detect whether the model itself changed in the meantime.
  pendingConsent: {
    readonly consentRequestId: string;
    readonly target: TrustedBenchmarkTarget;
  } | null;
  runtimeLease: RuntimeOperationLease | null;
}

// Why a run's runtime recovery step did not end cleanly. "isolation" (the
// old work is not proven isolated -> lease quarantined) and "readiness"
// (isolated, but no usable runtime came back -> lease released) are
// deliberately separate facts; see ModelBenchmarkRuntimeRecovery.
type RecoveryFailure = null | "isolation" | "readiness";

interface Deadline {
  remainingMs(): number;
}

function createDeadline(totalMs: number): Deadline {
  const deadlineAt = Date.now() + totalMs;
  return { remainingMs: () => Math.max(0, deadlineAt - Date.now()) };
}

function generateOpaqueId(prefix: string): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && "randomUUID" in cryptoObj)
    return `${prefix}-${cryptoObj.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type BoundedOperationResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout"; started: boolean }
  | { kind: "error"; error: unknown }
  | { kind: "inactive" };

// The thunk is intentionally invoked only after currency and remaining-
// budget checks. Synchronous throws and rejected promises become explicit
// data, and the timer is cleared on every settled path.
async function runBoundedOperation<T>(
  isActive: () => boolean,
  deadline: Deadline,
  maximumMs: number,
  operation: () => Promise<T> | T,
): Promise<BoundedOperationResult<T>> {
  if (!isActive()) return { kind: "inactive" };
  const timeoutMs = Math.min(maximumMs, deadline.remainingMs());
  if (timeoutMs <= 0) return { kind: "timeout", started: false };

  let operationPromise: Promise<T>;
  try {
    operationPromise = Promise.resolve(operation());
  } catch (error) {
    return { kind: "error", error };
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const settled = operationPromise.then<
    BoundedOperationResult<T>,
    BoundedOperationResult<T>
  >(
    (value) => ({ kind: "ok", value }),
    (error: unknown) => ({ kind: "error", error }),
  );
  const timedOut = new Promise<BoundedOperationResult<T>>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve({ kind: "timeout", started: true }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

type AbortableOperationResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; error: unknown }
  // The runner's own timer fired, the operation was aborted, and it then
  // SETTLED within the abort grace -- so it is confirmed to have stopped.
  // `started: false` means the operation was never invoked (no budget left).
  | { kind: "timeout"; started: boolean }
  // The runner's own timer fired, the operation was aborted, and it STILL had
  // not settled when the abort grace ended: the dependency ignored its
  // AbortSignal. The operation is ABANDONED -- it may still be running and
  // may still produce late effects, so its quiescence is unproven and the
  // caller must fail closed (quarantine) instead of releasing ownership.
  | { kind: "abandoned"; settled: Promise<void> }
  | { kind: "inactive" };

// The operation receives an AbortSignal and is expected to honor it, but the
// runner NEVER depends on that expectation for its own liveness: after the
// timeout it waits at most `abortGraceMs` for the operation to confirm it
// stopped, then reports "abandoned". A dependency that never settles can
// therefore delay this call by at most (timeout + grace) -- never forever.
// `deadline: null` is reserved for the mandatory isolation step (runtime
// recovery), which must not be skipped merely because the work budget is
// spent; its window is the fixed `maximumMs`. Every timer is cleared on every
// path, and the dangling operation promise always has handlers attached so a
// late rejection can never become an unhandled rejection.
async function runAbortableBoundedOperation<T>(
  isActive: () => boolean,
  deadline: Deadline | null,
  maximumMs: number,
  abortGraceMs: number,
  operation: (signal: AbortSignal) => Promise<T> | T,
): Promise<AbortableOperationResult<T>> {
  if (!isActive()) return { kind: "inactive" };
  const timeoutMs =
    deadline === null
      ? maximumMs
      : Math.min(maximumMs, deadline.remainingMs());
  if (timeoutMs <= 0) return { kind: "timeout", started: false };

  const controller = new AbortController();
  let operationPromise: Promise<T>;
  try {
    operationPromise = Promise.resolve(operation(controller.signal));
  } catch (error) {
    return { kind: "error", error };
  }

  const settled = operationPromise.then<
    AbortableOperationResult<T>,
    AbortableOperationResult<T>
  >(
    (value) => ({ kind: "ok", value }),
    (error: unknown) => ({ kind: "error", error }),
  );
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let graceHandle: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<{ kind: "timeout"; started: true }>(
    (resolve) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        resolve({ kind: "timeout", started: true });
      }, timeoutMs);
    },
  );

  try {
    const first = await Promise.race([settled, timedOut]);
    if (first.kind !== "timeout") return first;

    const graceExpired = new Promise<"grace_expired">((resolve) => {
      graceHandle = setTimeout(() => resolve("grace_expired"), abortGraceMs);
    });
    const second = await Promise.race([
      settled.then(() => "settled" as const),
      graceExpired,
    ]);
    return second === "settled"
      ? { kind: "timeout", started: true }
      : { kind: "abandoned", settled: settled.then(() => undefined) };
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (graceHandle !== null) clearTimeout(graceHandle);
  }
}

function buildLoadMeasurement(
  wasModelCachedBeforeRun: boolean,
  modelLoadedDuringRun: boolean,
  loadTimeMs?: number,
): ModelBenchmarkLoadMeasurement {
  return modelLoadedDuringRun && loadTimeMs !== undefined
    ? { wasModelCachedBeforeRun, modelLoadedDuringRun: true, loadTimeMs }
    : { wasModelCachedBeforeRun, modelLoadedDuringRun };
}

// Every RuntimeErrorCode a load attempt could plausibly fail with, mapped to
// the Phase-0 ModelBenchmarkOutcome vocabulary. "device_lost" is defined in
// that vocabulary but deliberately never produced here: ai-runtime's own
// classifyRuntimeError() (see errors.ts) already folds WebLLM's
// DeviceLostError into "out_of_memory" rather than a distinct code, so this
// runner has no distinctly-represented device-loss signal to map from --
// inventing one anyway would fabricate a distinction the runtime does not
// actually make. Reserved for a GENUINE runtime-reported load failure only
// -- a runner-level load TIMEOUT is a separate, neutral outcome
// ("load_timeout"), never routed through this function (see
// runExecutionPhase() below).
function classifyLoadFailure(
  errorCode: RuntimeErrorCode | undefined,
): ModelBenchmarkOutcome {
  return errorCode === "out_of_memory" ? "out_of_memory" : "load_failed";
}

// Maps a generation-phase RuntimeErrorCode (from a `{type: "error"}` chunk)
// to a (stage, outcome) pair legal under validation.ts's own
// LEGAL_STAGE_OUTCOMES table.
//
// - "out_of_memory": genuine negative evidence.
// - "generation_stalled": ai-runtime's OWN internal no-progress watchdog
//   firing -- genuine negative evidence about the model/runtime, never
//   folded into a runner-policy outcome.
// - "generation_exceeded_safety_limit"/"cancel_timeout": ai-runtime's OWN
//   internal safety-cap/cancel-confirmation limits -- these are POLICY/
//   recovery limits, not evidence the model itself misbehaved, so they map
//   to the neutral "benchmark_timeout", exactly like the runner's own
//   tighter timeouts do.
// - anything else: neutral terminal_unknown. Only the affirmative
//   generation_stalled code is sufficient evidence for a negative stall.
function classifyGenerationRuntimeError(
  errorCode: RuntimeErrorCode,
  sawFirstToken: boolean,
): { stage: ModelBenchmarkStage; outcome: ModelBenchmarkOutcome } {
  const stage: ModelBenchmarkStage = sawFirstToken
    ? "generating"
    : "awaiting_first_token";
  if (errorCode === "out_of_memory") return { stage, outcome: "out_of_memory" };
  if (errorCode === "generation_stalled") return { stage, outcome: "stalled" };
  if (
    errorCode === "generation_exceeded_safety_limit" ||
    errorCode === "cancel_timeout"
  ) {
    return { stage, outcome: "benchmark_timeout" };
  }
  return { stage, outcome: "terminal_unknown" };
}

// A model that merely stopped is not a model that worked: POSITIVE stability
// evidence ("completed") requires that real output was actually produced.
//
// - exact usage, completionTokens > 0, output observed   -> completed
// - exact usage, completionTokens === 0 (or not a positive
//   number)                                              -> terminal_unknown
// - exact usage, completionTokens > 0 but NO output chunk
//   was ever observed                                    -> terminal_unknown
//   (the runtime's accounting and the stream contradict each other; neither
//   is trusted, so the run fails closed to neutral)
// - usage unavailable, output observed                   -> completed (the
//   token count is honestly unknown, but output demonstrably existed)
// - usage unavailable, nothing observed                  -> terminal_unknown
//
// Never a negative outcome: an empty completion is an unconfirmed run, not
// evidence of instability -- it only declines to improve the model's record.
function classifyCompletedGeneration(
  metrics: GenerationRuntimeMetrics | null,
  sawOutput: boolean,
): ModelBenchmarkOutcome {
  if (metrics === null) return "terminal_unknown";
  const usage = metrics.usage;
  if (usage.tokenCountConfidence === "exact") {
    if (!(usage.completionTokens > 0)) return "terminal_unknown";
    return sawOutput ? "completed" : "terminal_unknown";
  }
  return sawOutput ? "completed" : "terminal_unknown";
}

function isValidEligibilityResult(
  value: unknown,
): value is BenchmarkEligibilityResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.eligible === true) return true;
  return (
    candidate.eligible === false &&
    typeof candidate.reasonCode === "string" &&
    /^[a-z0-9][a-z0-9._-]{0,79}$/.test(candidate.reasonCode) &&
    typeof candidate.message === "string" &&
    candidate.message.length > 0 &&
    candidate.message.length <= 500
  );
}

export function createModelBenchmarkRunner(
  options: ModelBenchmarkRunnerOptions,
): ModelBenchmarkRunner {
  const runtime = options.runtime;
  const targetResolver = options.targetResolver;
  const environmentProvider = options.environmentProvider;
  const eligibilityEvaluator = options.eligibilityEvaluator;
  const recoverRuntime = options.recoverRuntime;
  const inspectModelCache = options.inspectModelCache ?? isModelCached;
  const store = options.store ?? new ModelBenchmarkStoreClient();
  // The runner's no-late-write guarantee rests on the cancellation semantics of
  // this package's own store implementations, so only a client those
  // implementations stand behind is accepted. A structurally similar object, a
  // forged prototype, a Proxy, or a subclass is refused up front (see
  // trusted-store.ts).
  if (
    !isTrustedStoreClient(store) ||
    Object.getPrototypeOf(store) !== ModelBenchmarkStoreClient.prototype
  ) {
    throw new TypeError(
      "createModelBenchmarkRunner requires a ModelBenchmarkStoreClient created by @free-ai-open/model-benchmark.",
    );
  }
  const now = options.now ?? (() => new Date());
  const automatedBudgetMs =
    options.automatedBudgetMs !== undefined &&
    Number.isFinite(options.automatedBudgetMs) &&
    options.automatedBudgetMs > 0
      ? options.automatedBudgetMs
      : TOTAL_AUTOMATED_BUDGET_MS;
  const runtimeOperations = getRuntimeOperationCoordinator(runtime);

  let state: ModelBenchmarkRunnerState = { status: "idle" };
  const listeners = new Set<(state: ModelBenchmarkRunnerState) => void>();
  let nextRunId = 0;
  // The single currently-active attempt, or null when idle/terminal. This
  // (not a bare boolean) is what a second start()/confirmConsent() call
  // checks -- see busyRejection()'s own comment on why a rejection in this
  // case must never call setState().
  let activeRun: RunContext | null = null;
  // True while a persistence write the runner had to ABANDON (it ignored its
  // abort signal past the bounded grace) has still not settled. A STORAGE-only
  // fact: it blocks new benchmark runs (so a possibly-late write can never
  // interleave with the next run's), and nothing else -- never the runtime
  // coordinator, never chat. Cleared the moment the abandoned write settles.
  let persistenceUnsettled = false;

  // Subscribers OBSERVE the runner; they never control it. A listener that
  // throws (or returns a rejected promise) must not break the run's own
  // control flow -- start()/confirmConsent() must still resolve, activeRun
  // must still be cleaned up, and the next run must still work -- so every
  // listener call is individually contained. Notifications are delivered in
  // order through a queue so a listener that re-enters the runner (e.g.
  // calls cancel() from inside its callback) can never cause a later
  // listener to observe states out of order, and a snapshot of the listener
  // set is walked so subscribing/unsubscribing during a notification is
  // well-defined (an unsubscribed listener is never called afterwards).
  const pendingNotifications: ModelBenchmarkRunnerState[] = [];
  let notifying = false;

  function setState(next: ModelBenchmarkRunnerState): void {
    state = next;
    pendingNotifications.push(next);
    if (notifying) return;
    notifying = true;
    try {
      while (pendingNotifications.length > 0) {
        const snapshot = pendingNotifications.shift()!;
        for (const listener of [...listeners]) {
          if (!listeners.has(listener)) continue;
          try {
            const returned: unknown = listener(snapshot);
            if (
              returned !== null &&
              typeof returned === "object" &&
              typeof (returned as { then?: unknown }).then === "function"
            ) {
              (returned as PromiseLike<unknown>).then(undefined, () => {});
            }
          } catch {
            // Deliberately swallowed: see the comment above.
          }
        }
      }
    } finally {
      notifying = false;
    }
  }

  function getState(): ModelBenchmarkRunnerState {
    return state;
  }

  function isCurrent(run: RunContext): boolean {
    return activeRun === run;
  }

  // The single place a run's OWN lifecycle actually ends: clears
  // `activeRun` (making the runner available for a new start()) and
  // publishes the final state. Guarded by isCurrent() so a call arriving
  // from an already-superseded/abandoned code path can never clobber
  // whatever the CURRENT run (or a fresh idle runner) has since become.
  function finalizeRun(
    run: RunContext,
    finalState: ModelBenchmarkRunnerState,
  ): ModelBenchmarkRunnerState {
    if (!isCurrent(run)) return getState();
    run.runtimeLease?.release();
    run.runtimeLease = null;
    activeRun = null;
    setState(finalState);
    return finalState;
  }

  function failRun(
    run: RunContext,
    code: ModelBenchmarkRunnerErrorCode,
    message: string,
    persistedResult?: ModelBenchmarkResult,
  ): ModelBenchmarkRunnerState {
    return finalizeRun(run, {
      status: "failed",
      modelId: run.modelId,
      error: { code, message },
      ...(persistedResult ? { persistedResult } : {}),
    });
  }

  // A rejection describing THIS call's own outcome -- deliberately NEVER
  // calls setState(). The runner's true, ongoing state (whatever the
  // legitimately active run is doing) must never be overwritten just
  // because a second, doomed start()/confirmConsent() call was also made;
  // see the mission's own "second start while a run is active must not
  // mutate run A" requirement. A caller must read the RETURNED value for
  // this call's own result and call getState()/subscribe() separately for
  // the runner's actual ongoing status.
  function busyRejection(): ModelBenchmarkRunnerState {
    return {
      status: "failed",
      error: {
        code: "benchmark_already_running",
        message: "A benchmark run is already in progress.",
      },
    };
  }

  function buildResult(
    target: TrustedBenchmarkTarget,
    environment: TrustedBenchmarkEnvironmentSnapshot,
    stage: ModelBenchmarkStage,
    outcome: ModelBenchmarkOutcome,
    load: ModelBenchmarkLoadMeasurement,
    firstToken: ModelBenchmarkFirstTokenMeasurement,
    generation: ModelBenchmarkGenerationMeasurement,
  ): ModelBenchmarkResult {
    const createdAt = now().toISOString();
    const result: ModelBenchmarkResult = {
      schemaVersion: MODEL_BENCHMARK_SCHEMA_VERSION,
      benchmarkVersion: MODEL_BENCHMARK_VERSION,
      id: generateOpaqueId("benchmark"),
      modelId: target.modelId,
      model: target,
      createdAt,
      expiresAt: calculateModelBenchmarkExpiry(createdAt),
      browserFamily: environment.browserFamily,
      capabilityProfileKey: environment.capabilityProfileKey,
      performanceMode: environment.performanceMode,
      preset: "quick",
      runConfig: {
        contextPreset: QUICK_MODEL_BENCHMARK_PRESET.contextPreset,
        contextWindowTokens: QUICK_MODEL_BENCHMARK_PRESET.contextWindowTokens,
        requestedOutputTokens: QUICK_MODEL_BENCHMARK_PRESET.outputTokens,
      },
      stage,
      outcome,
      load,
      firstToken,
      generation,
      environment: { webllmVersion: INSTALLED_WEBLLM_VERSION },
    };
    if (environment.appVersion !== undefined)
      result.environment.appVersion = environment.appVersion;
    return result;
  }

  // The final step of every measured attempt: persists through the
  // existing sanitized ModelBenchmarkStoreClient path (never bypassed) and
  // reports a persistence failure as the runner's own "failed" status
  // rather than silently discarding it. Bounded by PERSISTENCE_TIMEOUT_MS,
  // itself clamped by whatever remains of the shared deadline, plus a
  // bounded abort-settlement grace.
  //
  // Persistence does NOT own the shared runtime. The runtime lease covers
  // runtime work only (load, generation, recovery): the moment recovery has
  // left the old runtime work isolated, the lease is released and persistence
  // proceeds on its own -- so a slow or failing store can never block chat. If
  // recovery could NOT prove isolation the lease stays quarantined (that is a
  // RUNTIME fact and persistence has no say in it).
  //
  // The runner only ever talks to a TRUSTED, package-owned store client (see
  // trusted-store.ts), whose official backends guarantee that an aborted write
  // can no longer mutate storage. After the abort grace there are therefore
  // two situations:
  //   - the write settled (ok / error / settled-after-abort): the storage work
  //     is quiescent -> an ordinary persistence_failed at worst;
  //   - the write did not settle even after being aborted ("abandoned"; only a
  //     trusted store violating its own contract can do this): the run ends as
  //     persistence_isolation_failed and new benchmark runs are refused until
  //     it settles -- storage state only, never the runtime coordinator.
  // Failure precedence (most to least severe): runtime_isolation_failed,
  // runtime_recovery_failed (isolated but not ready), persistence_isolation_
  // failed, persistence_failed.
  async function finalizeAndPersist(
    run: RunContext,
    target: TrustedBenchmarkTarget,
    environment: TrustedBenchmarkEnvironmentSnapshot,
    stage: ModelBenchmarkStage,
    outcome: ModelBenchmarkOutcome,
    load: ModelBenchmarkLoadMeasurement,
    firstToken: ModelBenchmarkFirstTokenMeasurement,
    generation: ModelBenchmarkGenerationMeasurement,
    deadline: Deadline,
    recoveryFailure: RecoveryFailure,
  ): Promise<ModelBenchmarkRunnerState> {
    // Runtime work is finalized (isolated, or already quarantined): hand the
    // runtime back before touching storage. A quarantined lease cannot be
    // released, so this is a no-op exactly when isolation is unproven.
    run.runtimeLease?.release();
    run.runtimeLease = null;

    setState({ status: "persisting", modelId: run.modelId });
    const result = buildResult(
      target,
      environment,
      stage,
      outcome,
      load,
      firstToken,
      generation,
    );

    const persistOutcome = await runAbortableBoundedOperation(
      () => isCurrent(run),
      deadline,
      PERSISTENCE_TIMEOUT_MS,
      PERSISTENCE_ABORT_GRACE_MS,
      (signal) => store.recordResult(result, { signal }),
    );
    if (!isCurrent(run)) return getState();

    const persisted = persistOutcome.kind === "ok" && persistOutcome.value;
    const persistenceAbandoned = persistOutcome.kind === "abandoned";
    if (persistOutcome.kind === "abandoned") {
      persistenceUnsettled = true;
      void persistOutcome.settled.then(() => {
        persistenceUnsettled = false;
      });
    }

    if (recoveryFailure === "isolation") {
      return failRun(
        run,
        "runtime_isolation_failed",
        persisted
          ? "The benchmark evidence was saved, but the old runtime work could not be proven isolated; the runtime stays quarantined."
          : "The old runtime work could not be proven isolated and the benchmark measurement could not be saved; the runtime stays quarantined.",
        persisted ? result : undefined,
      );
    }
    if (recoveryFailure === "readiness") {
      return failRun(
        run,
        "runtime_recovery_failed",
        persisted
          ? "The benchmark evidence was saved, but the shared runtime could not be recovered to a usable state."
          : "Runtime recovery failed and the benchmark measurement could not be saved.",
        persisted ? result : undefined,
      );
    }
    if (persistenceAbandoned) {
      return failRun(
        run,
        "persistence_isolation_failed",
        "The result store did not stop its write after being aborted; new benchmarks wait until it settles. The runtime is not affected.",
      );
    }
    if (!persisted) {
      return failRun(
        run,
        "persistence_failed",
        persistOutcome.kind === "timeout" && !persistOutcome.started
          ? "The benchmark measurement could not be saved before the deadline."
          : "The benchmark measurement could not be saved.",
      );
    }
    return finalizeRun(run, {
      status: "completed",
      modelId: run.modelId,
      result,
    });
  }

  // Attempts to leave the shared runtime in a known-safe (idle/ready) state
  // before persisting, whenever the runner's OWN cancellation/timeout/
  // failure handling could have left it otherwise (e.g. a clean
  // stream-based cancellation deliberately leaves ai-runtime's own status
  // at "cancelling" until "the app recycles it" -- see runtime.test.ts's
  // own "keeps the interrupted runtime in cancelling after confirmation
  // until the app recycles it" -- or a forced recovery leaves it at
  // "error"). Delegates to the REQUIRED injected `recoverRuntime()` rather
  // than reimplementing worker-level recovery in this package: this
  // package only holds an `InferenceRuntime` reference, not the worker
  // factory a real replace/recycle needs. The adapter is abort-aware and
  // receives the current lease so replacement remains inside the same
  // ownership burst.
  //
  // `forceRecovery` is set whenever the runner ABANDONED runtime work (a
  // load that never settled, a generator it gave up on): the reported
  // runtime status says nothing about whether that old work is still alive,
  // so recovery -- the only thing that can isolate it -- is mandatory.
  //
  // The adapter's answer is read as two independent facts (see
  // ModelBenchmarkRuntimeRecovery); `ready: true` additionally requires the
  // runtime to actually report status "ready". Anything that does not PROVE
  // isolation --
  // isolated:false, a rejection, a malformed/legacy result, a timeout, or an
  // adapter that ignores its abort signal -- quarantines the lease: the old
  // work might still be running, so no other operation may ever be handed
  // the runtime. Whatever happens, already-measured evidence is still
  // persisted; failure stays visible rather than becoming normal completion.
  async function recoverThenPersist(
    run: RunContext,
    target: TrustedBenchmarkTarget,
    environment: TrustedBenchmarkEnvironmentSnapshot,
    stage: ModelBenchmarkStage,
    outcome: ModelBenchmarkOutcome,
    load: ModelBenchmarkLoadMeasurement,
    firstToken: ModelBenchmarkFirstTokenMeasurement,
    generation: ModelBenchmarkGenerationMeasurement,
    deadline: Deadline,
    forceRecovery = false,
  ): Promise<ModelBenchmarkRunnerState> {
    let recoveryFailure: RecoveryFailure = null;
    const rtStatus = runtime.getState().status;
    if (forceRecovery || (rtStatus !== "idle" && rtStatus !== "ready")) {
      setState({ status: "recovering", modelId: run.modelId });
      const recoveryOutcome = await runAbortableBoundedOperation(
        () => isCurrent(run),
        null,
        RUNTIME_RECOVERY_TIMEOUT_MS,
        RUNTIME_RECOVERY_ABORT_GRACE_MS,
        (signal) => recoverRuntime({ signal, lease: run.runtimeLease! }),
      );
      if (!isCurrent(run)) return getState();
      const recovery: RuntimeRecoveryResult =
        recoveryOutcome.kind === "ok"
          ? normalizeRuntimeRecoveryResult(recoveryOutcome.value)
          : { isolated: false, ready: false };
      if (!recovery.isolated) {
        recoveryFailure = "isolation";
        run.runtimeLease?.quarantine();
      } else if (!recovery.ready || runtime.getState().status !== "ready") {
        // ready=true is a CLAIM about the observable runtime; it is accepted
        // only when the runtime really reports "ready". "idle" (no model
        // loaded) is not readiness, and is never silently normalized to it: a
        // ready claim the runtime contradicts is a contract violation and
        // fails closed.
        recoveryFailure = "readiness";
      }
    }
    return finalizeAndPersist(
      run,
      target,
      environment,
      stage,
      outcome,
      load,
      firstToken,
      generation,
      deadline,
      recoveryFailure,
    );
  }

  async function runGenerationPhase(
    run: RunContext,
    target: TrustedBenchmarkTarget,
    environment: TrustedBenchmarkEnvironmentSnapshot,
    load: ModelBenchmarkLoadMeasurement,
    deadline: Deadline,
  ): Promise<ModelBenchmarkRunnerState> {
    if (deadline.remainingMs() <= 0) {
      return failRun(
        run,
        "operation_timeout",
        "The automated benchmark budget expired before generation could start.",
      );
    }
    setState({ status: "running", modelId: run.modelId });

    const preset = QUICK_MODEL_BENCHMARK_PRESET;
    let sawFirstToken = false;
    // Whether any non-empty output was actually observed on the stream. Only
    // this boolean is kept -- never the text itself.
    let sawOutput = false;
    let terminalChunk: Extract<GenerateChunk, { type: "done" }> | null = null;
    let terminalError: RuntimeError | null = null;

    let firstTokenTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let absoluteTimer: ReturnType<typeof setTimeout> | null = null;

    function clearAllTimers(): void {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      if (stallTimer) clearTimeout(stallTimer);
      if (absoluteTimer) clearTimeout(absoluteTimer);
      firstTokenTimer = null;
      stallTimer = null;
      absoluteTimer = null;
    }

    // Fires runtime.stopGeneration() for one of THIS benchmark's own
    // (tighter) timeouts -- deliberately separate from, and never
    // modifying, ai-runtime's own internal generation watchdog, which stays
    // active underneath as the much larger safety net it already was. Only
    // the FIRST trigger to fire records itself in `run.stopTrigger`;
    // stopGeneration() itself is idempotent.
    function triggerBenchmarkTimeout(): void {
      if (run.stopTrigger === "none") run.stopTrigger = "timeout";
      runtime.stopGeneration();
    }

    const generationBudgetMs = deadline.remainingMs();
    if (generationBudgetMs <= 0) {
      return failRun(
        run,
        "operation_timeout",
        "The automated benchmark budget expired before generation could start.",
      );
    }
    const firstTokenTimeoutMs = Math.min(
      preset.firstTokenTimeoutMs,
      generationBudgetMs,
    );
    const absoluteTimeoutMs = Math.min(
      preset.absoluteBenchmarkTimeoutMs,
      generationBudgetMs,
    );
    firstTokenTimer = setTimeout(triggerBenchmarkTimeout, firstTokenTimeoutMs);
    absoluteTimer = setTimeout(triggerBenchmarkTimeout, absoluteTimeoutMs);

    const consumePromise = (async () => {
      for await (const chunk of runtime.generate({
        conversationId: BENCHMARK_CONVERSATION_ID,
        prompt: getQuickBenchmarkPrompt(),
        maxOutputTokens: preset.outputTokens,
      })) {
        if (chunk.type === "token") {
          if (typeof chunk.text === "string" && chunk.text.length > 0)
            sawOutput = true;
          if (!sawFirstToken) {
            sawFirstToken = true;
            if (firstTokenTimer) {
              clearTimeout(firstTokenTimer);
              firstTokenTimer = null;
            }
          }
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = setTimeout(
            triggerBenchmarkTimeout,
            Math.min(preset.stallTimeoutMs, deadline.remainingMs()),
          );
        } else if (chunk.type === "done") {
          terminalChunk = chunk;
          break;
        } else {
          terminalError = chunk.error;
          break;
        }
      }
    })().catch(() => {
      // runtime.generate() is not expected to throw (every internal failure
      // is surfaced as a yielded {type:"error"} chunk instead -- see
      // ai-runtime's runtime.ts) -- caught defensively so an unexpected
      // rejection can never become an unhandled promise rejection.
      terminalError = {
        code: "unknown",
        message: "The runtime generation operation failed unexpectedly.",
      };
    });

    // A hard outer bound on how long this benchmark run will keep waiting
    // for the generator above to actually yield a terminal chunk, covering
    // ai-runtime's own cancel-confirmation window with margin. Deliberately
    // an addition on top of the ordinary absolute generation limit, still
    // clamped by the ONE shared automated-burst deadline. If earlier checks
    // or loading consumed most of that budget, teardown gets only the true
    // remainder rather than silently extending the burst.
    const hardTimeoutMs = Math.min(
      absoluteTimeoutMs + GENERATION_TEARDOWN_GRACE_MS,
      deadline.remainingMs(),
    );
    const gaveUpMarker = Symbol("benchmark-generation-teardown");
    let hardTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const hardTimeout = new Promise<typeof gaveUpMarker>((resolve) => {
      hardTimeoutHandle = setTimeout(
        () => resolve(gaveUpMarker),
        hardTimeoutMs,
      );
    });
    const raceResult = await Promise.race([
      consumePromise.then(() => null),
      hardTimeout,
    ]);
    if (hardTimeoutHandle !== null) clearTimeout(hardTimeoutHandle);
    clearAllTimers();

    if (!isCurrent(run)) return getState();

    const gaveUp = raceResult === gaveUpMarker;
    // Re-typed rather than read directly: both were only ever assigned
    // inside the nested async loop above, so TypeScript's control-flow
    // narrowing (which does not trace assignments across a closure boundary
    // back into this outer scope) would otherwise treat them as statically
    // `null` here and narrow a truthy check to `never`. The actual runtime
    // value is correct regardless -- ordinary JS closure semantics, not
    // TS's static narrowing, govern what these hold once `consumePromise`
    // has settled.
    const finalChunk = terminalChunk as Extract<
      GenerateChunk,
      { type: "done" }
    > | null;
    const finalError = terminalError as RuntimeError | null;

    let stage: ModelBenchmarkStage;
    let outcome: ModelBenchmarkOutcome;
    if (gaveUp) {
      // The runner itself gave up waiting -- this IS one of the runner's
      // own recognized policy limits (the hard teardown grace expired),
      // never conflated with genuine model instability.
      stage = sawFirstToken ? "generating" : "awaiting_first_token";
      outcome = "benchmark_timeout";
    } else if (finalError) {
      const classified = classifyGenerationRuntimeError(
        finalError.code,
        sawFirstToken,
      );
      stage = classified.stage;
      outcome = classified.outcome;
    } else if (finalChunk) {
      const reason = finalChunk.reason;
      if (reason === "completed") {
        stage = "complete";
        outcome = classifyCompletedGeneration(finalChunk.metrics, sawOutput);
      } else if (reason === "length") {
        stage = "complete";
        outcome = "length_limited";
      } else if (reason === "unsupported_tool_call") {
        stage = "complete";
        outcome = "unsupported_tool_call";
      } else if (reason === "unknown_terminal") {
        stage = "complete";
        outcome = "terminal_unknown";
      } else if (reason === "degenerate_output") {
        // Detection only ever fires after at least one output character has
        // been produced -- see @free-ai-open/ai-runtime's detectDegenerateOutput().
        stage = "generating";
        outcome = "degenerate";
      } else {
        // reason === "cancelled": reinterpret per who actually asked for the
        // stop. A cancellation the runner's OWN timeout requested is the
        // runner's own policy limit (neutral "benchmark_timeout"), never
        // model instability; a cancellation neither the caller nor the
        // runner's own timeouts requested (stopTrigger still "none",
        // defensively unexpected) is never assumed to be a benign user
        // cancellation it was not, so it also falls to the neutral policy
        // bucket rather than being silently relabeled "cancelled".
        stage = sawFirstToken ? "generating" : "awaiting_first_token";
        outcome =
          run.stopTrigger === "caller_cancel"
            ? "cancelled"
            : "benchmark_timeout";
      }
    } else {
      // Defensive: the generator returned without ever yielding a terminal
      // chunk at all, and this did NOT go through the hard-teardown
      // give-up path above -- genuinely unexplained, and NOT attributable
      // to any of the runner's own recognized policy triggers, so this is
      // neutral terminal_unknown. A stall requires the runtime's positive
      // generation_stalled signal; silence is never negative evidence.
      stage = sawFirstToken ? "generating" : "awaiting_first_token";
      outcome = "terminal_unknown";
    }

    const reachesMeasurements = STAGES_WITH_MEASUREMENTS.has(stage);
    const doneMetrics = finalChunk !== null ? finalChunk.metrics : null;

    // NEVER fabricated: firstTokenTimeMs is populated ONLY from a real
    // Phase-1 GenerationRuntimeMetrics.timeToFirstTokenMs value attached to
    // an actual "done" chunk. There is deliberately no fallback to any
    // runner-tracked wall-clock timestamp (start time, token-callback time,
    // timeout time, teardown time) -- an error chunk or the hard-teardown
    // give-up case simply has no first-token measurement, and
    // validation.ts's own sanitizeModelBenchmarkResult() was corrected in
    // this same phase to make that representable honestly (see its own
    // comment on the now one-directional reachedFirstToken check) rather
    // than forcing a choice between fabricating a timestamp and rejecting
    // an otherwise-honest record.
    const firstToken: ModelBenchmarkFirstTokenMeasurement =
      reachesMeasurements &&
      doneMetrics !== null &&
      doneMetrics.timeToFirstTokenMs !== null
        ? { firstTokenTimeMs: doneMetrics.timeToFirstTokenMs }
        : {};

    // Likewise never fabricated: generationDurationMs/generatedTokenCount/
    // overallCompletionTokensPerSecond are a direct passthrough of Phase-1's
    // own GenerationRuntimeMetrics, never recomputed. When no real metrics
    // object exists at all (an error chunk, or the give-up case), the
    // measurement stays honestly "unavailable" with no duration -- Phase-0's
    // own contract already makes generationDurationMs optional in the
    // "unavailable" variant for exactly this reason.
    const generation: ModelBenchmarkGenerationMeasurement =
      reachesMeasurements && doneMetrics !== null
        ? doneMetrics.usage.tokenCountConfidence === "exact"
          ? {
              tokenCountConfidence: "exact",
              generationDurationMs: doneMetrics.generationDurationMs,
              generatedTokenCount: doneMetrics.usage.completionTokens,
              overallCompletionTokensPerSecond:
                doneMetrics.usage.overallCompletionTokensPerSecond,
            }
          : {
              tokenCountConfidence: "unavailable",
              generationDurationMs: doneMetrics.generationDurationMs,
            }
        : { tokenCountConfidence: "unavailable" };

    // A generator the runner had to GIVE UP on is abandoned work: the
    // runtime's own status may still read idle/ready even though the old
    // stream was never proven finished, so recovery (the isolation step) is
    // mandatory regardless of the reported status.
    return recoverThenPersist(
      run,
      target,
      environment,
      stage,
      outcome,
      load,
      firstToken,
      generation,
      deadline,
      gaveUp,
    );
  }

  async function runExecutionPhase(
    run: RunContext,
    target: TrustedBenchmarkTarget,
    environment: TrustedBenchmarkEnvironmentSnapshot,
    wasModelCachedBeforeRun: boolean,
    deadline: Deadline,
  ): Promise<ModelBenchmarkRunnerState> {
    if (run.cancelRequested) return finalizeRun(run, { status: "idle" });
    const lease = runtimeOperations.tryAcquire(`model-benchmark:${run.runId}`);
    if (!lease) {
      return runtimeOperations.isQuarantined()
        ? failRun(
            run,
            "runtime_quarantined",
            "The shared runtime is quarantined until old work is proven isolated.",
          )
        : failRun(
            run,
            "runtime_busy",
            "The shared runtime is owned by another operation.",
          );
    }
    run.runtimeLease = lease;

    const rtState = runtime.getState();
    if (rtState.status !== "idle" && rtState.status !== "ready") {
      return failRun(
        run,
        "runtime_busy",
        `Cannot run a benchmark while the runtime is "${rtState.status}".`,
      );
    }
    const currentlyLoaded =
      rtState.status === "ready" && rtState.modelId === target.webllmModelId;
    const needsLoad = !currentlyLoaded;

    let modelLoadedDuringRun = false;
    let loadTimeMs: number | undefined;

    if (needsLoad) {
      setState({ status: "loading", modelId: run.modelId });
      const loadOutcome = await runBoundedOperation(
        () => isCurrent(run) && lease.isCurrent(),
        deadline,
        QUICK_MODEL_BENCHMARK_PRESET.loadTimeoutMs,
        () =>
          runtime.loadModel(target.webllmModelId, {
            contextWindowTokens:
              QUICK_MODEL_BENCHMARK_PRESET.contextWindowTokens,
          }),
      );
      if (!isCurrent(run)) return getState();

      if (loadOutcome.kind === "inactive") return getState();
      if (loadOutcome.kind === "timeout") {
        if (!loadOutcome.started) {
          return failRun(
            run,
            "operation_timeout",
            "The automated benchmark budget expired before model loading could start.",
          );
        }
        // Phase-0's own stage/outcome legality table has "load_timeout" at
        // stage "loading_model" specifically for this: a load that never
        // completes within this benchmark's own bound, distinct from a
        // genuine loadModel() failure -- see LEGAL_STAGE_OUTCOMES in
        // validation.ts. The abandoned loadModel() call itself keeps
        // running independently -- see raceWithTimeout()'s own comment.
        const outcome: ModelBenchmarkOutcome = run.cancelRequested
          ? "cancelled"
          : "load_timeout";
        return recoverThenPersist(
          run,
          target,
          environment,
          "loading_model",
          outcome,
          buildLoadMeasurement(wasModelCachedBeforeRun, false),
          {},
          { tokenCountConfidence: "unavailable" },
          deadline,
          // The abandoned loadModel() call keeps running independently --
          // isolation must be proven by recovery whatever the status says.
          true,
        );
      }

      if (loadOutcome.kind === "error" || loadOutcome.value === null) {
        const errorCode = runtime.getState().error?.code;
        const outcome: ModelBenchmarkOutcome = run.cancelRequested
          ? "cancelled"
          : classifyLoadFailure(errorCode);
        return recoverThenPersist(
          run,
          target,
          environment,
          "loading_model",
          outcome,
          buildLoadMeasurement(wasModelCachedBeforeRun, false),
          {},
          { tokenCountConfidence: "unavailable" },
          deadline,
        );
      }

      modelLoadedDuringRun = true;
      loadTimeMs = loadOutcome.value.loadTimeMs;
      if (run.cancelRequested) {
        return recoverThenPersist(
          run,
          target,
          environment,
          "loading_model",
          "cancelled",
          buildLoadMeasurement(wasModelCachedBeforeRun, true, loadTimeMs),
          {},
          { tokenCountConfidence: "unavailable" },
          deadline,
        );
      }
    }

    const load = buildLoadMeasurement(
      wasModelCachedBeforeRun,
      modelLoadedDuringRun,
      loadTimeMs,
    );
    return runGenerationPhase(run, target, environment, load, deadline);
  }

  // The shared "resolve trusted model -> trusted environment -> hard
  // eligibility -> informational cache check" sequence, used both by the
  // initial start() call and by confirmConsent()'s own fresh revalidation.
  // Every step is bounded (an injected/caller-supplied async function this
  // package does not control) and checked against `run`'s own currency
  // after each await.
  async function performChecks(
    run: RunContext,
    deadline: Deadline,
  ): Promise<
    | {
        ok: true;
        target: TrustedBenchmarkTarget;
        environment: TrustedBenchmarkEnvironmentSnapshot;
        wasModelCachedBeforeRun: boolean;
      }
    | { ok: false; state: ModelBenchmarkRunnerState }
  > {
    const targetOutcome = await runBoundedOperation(
      () => isCurrent(run),
      deadline,
      TRUSTED_LOOKUP_STEP_TIMEOUT_MS,
      () => targetResolver.resolve(run.modelId),
    );
    if (!isCurrent(run)) return { ok: false, state: getState() };
    if (run.cancelRequested)
      return { ok: false, state: finalizeRun(run, { status: "idle" }) };
    if (targetOutcome.kind === "inactive")
      return { ok: false, state: getState() };
    if (targetOutcome.kind === "timeout" || targetOutcome.kind === "error") {
      return {
        ok: false,
        state: failRun(
          run,
          "target_resolver_failed",
          "The trusted model resolver failed or timed out.",
        ),
      };
    }
    if (!targetOutcome.value) {
      return {
        ok: false,
        state: finalizeRun(run, {
          status: "failed",
          modelId: run.modelId,
          error: {
            code: "unknown_model",
            message:
              "The requested model is not a known, registry-verified benchmark target.",
          },
        }),
      };
    }
    const target = sanitizeModelReference(targetOutcome.value);
    if (!target || target.modelId !== run.modelId) {
      return {
        ok: false,
        state: failRun(
          run,
          "target_resolver_failed",
          "The trusted model resolver returned an invalid or mismatched target.",
        ),
      };
    }

    const environmentOutcome = await runBoundedOperation(
      () => isCurrent(run),
      deadline,
      TRUSTED_LOOKUP_STEP_TIMEOUT_MS,
      () => environmentProvider.getSnapshot(),
    );
    if (!isCurrent(run)) return { ok: false, state: getState() };
    if (run.cancelRequested)
      return { ok: false, state: finalizeRun(run, { status: "idle" }) };
    if (environmentOutcome.kind === "inactive")
      return { ok: false, state: getState() };
    if (
      environmentOutcome.kind === "timeout" ||
      environmentOutcome.kind === "error"
    ) {
      return {
        ok: false,
        state: failRun(
          run,
          "environment_provider_failed",
          "The trusted environment provider failed or timed out.",
        ),
      };
    }
    const environment = sanitizeTrustedBenchmarkEnvironment(
      environmentOutcome.value,
    );
    if (!environment) {
      return {
        ok: false,
        state: failRun(
          run,
          "environment_provider_failed",
          "The trusted environment provider returned an invalid snapshot.",
        ),
      };
    }

    const eligibilityOutcome = await runBoundedOperation(
      () => isCurrent(run),
      deadline,
      TRUSTED_LOOKUP_STEP_TIMEOUT_MS,
      () => eligibilityEvaluator.evaluate({ target, environment }),
    );
    if (!isCurrent(run)) return { ok: false, state: getState() };
    if (run.cancelRequested)
      return { ok: false, state: finalizeRun(run, { status: "idle" }) };
    if (eligibilityOutcome.kind === "inactive")
      return { ok: false, state: getState() };
    if (
      eligibilityOutcome.kind === "timeout" ||
      eligibilityOutcome.kind === "error"
    ) {
      return {
        ok: false,
        state: failRun(
          run,
          "eligibility_failed",
          "The hard-eligibility evaluator failed or timed out.",
        ),
      };
    }
    if (!isValidEligibilityResult(eligibilityOutcome.value)) {
      return {
        ok: false,
        state: failRun(
          run,
          "eligibility_failed",
          "The hard-eligibility evaluator returned an invalid result.",
        ),
      };
    }
    if (!eligibilityOutcome.value.eligible) {
      return {
        ok: false,
        state: finalizeRun(run, {
          status: "failed",
          modelId: run.modelId,
          error: {
            code: "ineligible_model",
            message: eligibilityOutcome.value.message,
          },
        }),
      };
    }

    // Informational only -- see runner-trust.ts and this file's own
    // "Consent" handling below for why cache presence is never itself a
    // consent/security boundary. A timeout here defaults to `false` (the
    // same safe direction ai-runtime's own isModelCached() already falls
    // back to on failure).
    const cacheOutcome = await runBoundedOperation(
      () => isCurrent(run),
      deadline,
      TRUSTED_LOOKUP_STEP_TIMEOUT_MS,
      () => inspectModelCache(target.webllmModelId),
    );
    if (!isCurrent(run)) return { ok: false, state: getState() };
    if (run.cancelRequested)
      return { ok: false, state: finalizeRun(run, { status: "idle" }) };
    if (cacheOutcome.kind === "inactive")
      return { ok: false, state: getState() };
    if (cacheOutcome.kind === "timeout" || cacheOutcome.kind === "error") {
      return {
        ok: false,
        state: failRun(
          run,
          "cache_inspection_failed",
          "The local model cache could not be inspected safely.",
        ),
      };
    }
    const wasModelCachedBeforeRun = cacheOutcome.value;

    return { ok: true, target, environment, wasModelCachedBeforeRun };
  }

  async function start(
    runOptions: ModelBenchmarkRunOptions,
  ): Promise<ModelBenchmarkRunnerState> {
    if (activeRun !== null) return busyRejection();

    const modelId = runOptions.modelId;
    if (
      typeof modelId !== "string" ||
      modelId.length === 0 ||
      modelId.length > 200
    ) {
      setState({
        status: "failed",
        error: {
          code: "unknown_model",
          message: "The requested model id is not valid.",
        },
      });
      return getState();
    }

    if (persistenceUnsettled) {
      setState({
        status: "failed",
        modelId,
        error: {
          code: "persistence_unsettled",
          message:
            "An earlier benchmark's result write has not settled yet; try again shortly.",
        },
      });
      return getState();
    }

    if (runtimeOperations.isQuarantined()) {
      setState({
        status: "failed",
        modelId,
        error: {
          code: "runtime_quarantined",
          message:
            "The shared runtime is quarantined until old work is proven isolated.",
        },
      });
      return getState();
    }

    const runtimeStatus = runtime.getState().status;
    if (runtimeStatus !== "idle" && runtimeStatus !== "ready") {
      setState({
        status: "failed",
        modelId,
        error: {
          code: "runtime_busy",
          message: `Cannot start a benchmark while the runtime is "${runtimeStatus}".`,
        },
      });
      return getState();
    }

    const run: RunContext = {
      runId: ++nextRunId,
      modelId,
      cancelRequested: false,
      stopTrigger: "none",
      pendingConsent: null,
      runtimeLease: null,
    };
    activeRun = run;
    setState({ status: "checking", modelId });
    const deadline = createDeadline(automatedBudgetMs);

    try {
      const checked = await performChecks(run, deadline);
      if (!checked.ok) return checked.state;
      const { target, environment, wasModelCachedBeforeRun } = checked;

      // See runner-trust.ts / this file's own top comment: cache presence is
      // informational only, never a consent/security boundary. Consent is
      // required for ANY load operation -- even a cached-but-not-currently-
      // loaded model -- because a partial/corrupted/stale cache entry can
      // still cause WebLLM to fetch over the network despite an earlier
      // "cached" check, and time-of-check/time-of-use makes cache status
      // alone unsafe to gate a network-capable operation on.
      const rtState = runtime.getState();
      const currentlyLoaded =
        rtState.status === "ready" && rtState.modelId === target.webllmModelId;
      const needsLoad = !currentlyLoaded;

      if (!needsLoad) {
        return await runExecutionPhase(
          run,
          target,
          environment,
          wasModelCachedBeforeRun,
          deadline,
        );
      }

      const consentRequestId = generateOpaqueId("consent");
      run.pendingConsent = { consentRequestId, target };
      setState({
        status: "requires_model_load_consent",
        modelId,
        consentRequestId,
      });
      return getState();
    } catch {
      return isCurrent(run)
        ? failRun(
            run,
            "runner_failed",
            "The benchmark runner failed unexpectedly.",
          )
        : getState();
    }
  }

  async function confirmConsent(
    consentRequestId: string,
  ): Promise<ModelBenchmarkRunnerState> {
    const run = activeRun;
    if (
      !run ||
      !run.pendingConsent ||
      run.pendingConsent.consentRequestId !== consentRequestId
    ) {
      // Deliberately no setState() -- see busyRejection()'s own comment.
      // Either there is no active run at all, or the active run is a
      // DIFFERENT attempt (or has already moved past consent) that this
      // stale/forged/reused id must never be allowed to advance.
      return {
        status: "failed",
        error: {
          code: "invalid_consent",
          message: "This consent request is not the currently pending one.",
        },
      };
    }

    const previousTarget = run.pendingConsent.target;
    run.pendingConsent = null; // single-use: this exact id can never confirm twice.
    setState({ status: "checking", modelId: run.modelId });
    const deadline = createDeadline(automatedBudgetMs);

    try {
      const checked = await performChecks(run, deadline);
      if (!checked.ok) return checked.state;
      const { target, environment, wasModelCachedBeforeRun } = checked;

      if (!trustedBenchmarkTargetsEqual(target, previousTarget)) {
        return finalizeRun(run, {
          status: "failed",
          modelId: run.modelId,
          error: {
            code: "consent_stale",
            message:
              "The model changed since consent was requested; start a new benchmark.",
          },
        });
      }

      return await runExecutionPhase(
        run,
        target,
        environment,
        wasModelCachedBeforeRun,
        deadline,
      );
    } catch {
      return isCurrent(run)
        ? failRun(
            run,
            "runner_failed",
            "The benchmark runner failed unexpectedly.",
          )
        : getState();
    }
  }

  function cancel(): void {
    const run = activeRun;
    if (!run) return;

    switch (state.status) {
      case "checking":
      case "loading":
        run.cancelRequested = true;
        setState({ status: "cancelling", modelId: run.modelId });
        return;
      case "running":
        run.cancelRequested = true;
        if (run.stopTrigger === "none") run.stopTrigger = "caller_cancel";
        setState({ status: "cancelling", modelId: run.modelId });
        runtime.stopGeneration();
        return;
      case "requires_model_load_consent":
        // Nothing was ever attempted (no load, no generation) -- invalidate
        // the pending request outright rather than persisting a vacuous
        // "nothing happened" sample.
        run.pendingConsent = null;
        activeRun = null;
        setState({ status: "idle" });
        return;
      default:
        // cancelling / recovering / persisting / idle / completed / failed:
        // a no-op. Persistence is deliberately treated as non-cancellable
        // (the measurement is already fully computed and the write is
        // small/local) -- see finalizeAndPersist()'s own comment.
        return;
    }
  }

  return {
    getState,
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    confirmConsent,
    cancel,
  };
}

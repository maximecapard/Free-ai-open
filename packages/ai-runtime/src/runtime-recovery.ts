// Recovery of a shared inference runtime reports TWO independent facts, and
// collapsing them into one boolean "success" is unsafe:
//
// - `isolated`: the previous operation/domain (its worker, engine, stream and
//   any late callbacks) is quiescent or PHYSICALLY isolated -- e.g. the old
//   worker was confirmed terminated. Only this fact decides whether runtime
//   ownership may be handed back to ordinary operations.
// - `ready`: the runtime is usable again (a model is loaded and the status
//   is "ready"). A recovery may be perfectly safe yet leave nothing usable.
//
// isolated=true,  ready=true   -> safe and usable.
// isolated=true,  ready=false  -> safe to release ownership; the runtime
//                                 stays unavailable until reloaded.
// isolated=false (any ready)   -> NOT safe: ownership must stay held (or be
//                                 quarantined) -- never released to normal
//                                 operations. `ready` is meaningless here
//                                 and is always reported false.
//
// Content-free by construction: two booleans, no messages, no model data.
export interface RuntimeRecoveryResult {
  isolated: boolean;
  ready: boolean;
}

export function createRuntimeRecoveryResult(
  isolated: boolean,
  ready: boolean,
): RuntimeRecoveryResult {
  return isolated
    ? { isolated: true, ready }
    : { isolated: false, ready: false };
}

// Fails closed: anything that is not a well-formed result (a legacy boolean,
// null, a rejected/timed-out adapter's absent value, a missing field) means
// isolation was NOT proven. A claimed `ready` without isolation is
// contradictory and is discarded.
export function normalizeRuntimeRecoveryResult(
  value: unknown,
): RuntimeRecoveryResult {
  if (!value || typeof value !== "object") {
    return { isolated: false, ready: false };
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.isolated !== "boolean" ||
    typeof candidate.ready !== "boolean"
  ) {
    return { isolated: false, ready: false };
  }
  return createRuntimeRecoveryResult(candidate.isolated, candidate.ready);
}

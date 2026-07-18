import type { RuntimeStatus } from "@free-ai-open/ai-runtime";

// v0.7.0-alpha Phase 4: decides what must happen when the adaptive router's
// selected model differs from the model currently loaded in the persistent
// runtime. Mirrors performanceModeRuntimePolicy.ts's shape — a pure decision
// function the runtime provider executes, so the switching rules are testable
// without a real WebLLM worker.
export type ModelSwitchDecision =
  | { type: "noop" }
  | { type: "blocked_active_generation" }
  | { type: "needs_consent" }
  | { type: "switch_now" };

// Same "runtime is busy" definition used to block conversation switches
// (see runtimeUiState.ts's isConversationSwitchBlockedStatus) — a model swap
// must never silently interrupt an active generation.
export function isModelSwitchBlockedStatus(status: RuntimeStatus): boolean {
  return status === "generating" || status === "cancelling" || status === "recovering";
}

export interface ResolveModelSwitchInput {
  currentModelId: string | null;
  selectedModelId: string;
  runtimeStatus: RuntimeStatus;
  isCached: boolean;
  // The v0.6 default model (SmolLM2-360M) already has an existing, disclosed
  // first-run download flow (Getting Started) predating the adaptive router —
  // routing straight to it never needs a *new* consent prompt.
  isPreDisclosedDefault: boolean;
}

export function resolveModelSwitch(input: ResolveModelSwitchInput): ModelSwitchDecision {
  if (input.currentModelId === input.selectedModelId) {
    return { type: "noop" };
  }
  if (isModelSwitchBlockedStatus(input.runtimeStatus)) {
    return { type: "blocked_active_generation" };
  }
  if (input.isCached || input.isPreDisclosedDefault) {
    return { type: "switch_now" };
  }
  return { type: "needs_consent" };
}

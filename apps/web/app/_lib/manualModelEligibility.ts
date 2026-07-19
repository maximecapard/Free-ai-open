import type { RouterDecision, RouterRejectionCode } from "@free-ai-open/model-router";

export interface ManualModelEligibility {
  eligible: boolean;
  pending: boolean;
  rejectionReasons: RouterRejectionCode[];
}

// v0.7.0-alpha Phase 5: whether the manual model picker should let a normal
// user select a given registry model, per the mission's "do not let a normal
// user select clearly ineligible models." Reuses the adaptive router's own
// hard-gate output (RouterDecision.rejectedModels) rather than
// re-implementing eligibility rules in the UI layer — the router remains the
// single source of truth for what's actually loadable on this device.
// Until the router has a capability-backed decision, fail closed in the UI.
// This avoids presenting an unverified multi-gigabyte model as selectable
// while device profiling is still pending.
export function resolveManualModelEligibility(decision: RouterDecision | null, modelId: string): ManualModelEligibility {
  if (!decision) return { eligible: false, pending: true, rejectionReasons: [] };

  const rejected = decision.rejectedModels.find((item) => item.modelId === modelId);
  if (!rejected) return { eligible: true, pending: false, rejectionReasons: [] };

  return { eligible: false, pending: false, rejectionReasons: rejected.reasons };
}

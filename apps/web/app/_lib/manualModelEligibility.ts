import type { RouterDecision, RouterRejectionCode } from "@free-ai-open/model-router";

export interface ManualModelEligibility {
  eligible: boolean;
  rejectionReasons: RouterRejectionCode[];
}

// v0.7.0-alpha Phase 5: whether the manual model picker should let a normal
// user select a given registry model, per the mission's "do not let a normal
// user select clearly ineligible models." Reuses the adaptive router's own
// hard-gate output (RouterDecision.rejectedModels) rather than
// re-implementing eligibility rules in the UI layer — the router remains the
// single source of truth for what's actually loadable on this device.
// Without a decision yet (routing hasn't run), fails open (eligible) rather
// than blocking every model: the router still applies its real gates when
// the pick is actually routed, so this can never let an unsafe load through,
// only affects whether the button looks disabled before that happens.
export function resolveManualModelEligibility(decision: RouterDecision | null, modelId: string): ManualModelEligibility {
  if (!decision) return { eligible: true, rejectionReasons: [] };

  const rejected = decision.rejectedModels.find((item) => item.modelId === modelId);
  if (!rejected) return { eligible: true, rejectionReasons: [] };

  return { eligible: false, rejectionReasons: rejected.reasons };
}

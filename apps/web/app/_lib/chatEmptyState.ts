import type { RouterDecision } from "@free-ai-open/model-router";

export type ChatEmptyStateReason = "webgpu_unavailable" | "manual_model_ineligible" | "no_eligible_model";

// v0.7.0-alpha Phase 5: distinguishes the specific empty/error causes the
// mission calls out (WebGPU unavailable, manual model no longer eligible)
// from the generic "nothing is eligible" case, so chat can show a plain-
// language cause and a concrete next action instead of one catch-all
// message. Returns null when nothing needs surfacing (a model was selected
// and no relevant warning fired).
export function resolveChatEmptyStateReason(decision: RouterDecision): ChatEmptyStateReason | null {
  if (!decision.selectedModelId) {
    const rejectedForBackend =
      decision.rejectedModels.length > 0 &&
      decision.rejectedModels.every((rejected) => rejected.reasons.includes("backend_unavailable"));
    return rejectedForBackend ? "webgpu_unavailable" : "no_eligible_model";
  }

  if (decision.warnings.includes("manual_model_ineligible") || decision.warnings.includes("manual_model_unknown")) {
    return "manual_model_ineligible";
  }

  return null;
}

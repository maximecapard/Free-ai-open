import type { RejectionReason } from "@free-ai-open/model-router";
import type { ModelRouterResult } from "@free-ai-open/model-router";
import type { TranslationKey } from "../_i18n/dictionary";

const REJECTION_REASON_KEYS: Record<RejectionReason, TranslationKey> = {
  model_blocked: "router.rejection.model_blocked",
  task_not_supported: "router.rejection.task_not_supported",
  device_tier_too_low: "router.rejection.device_tier_too_low",
  backend_not_available: "router.rejection.backend_not_available",
};

export function rejectionReasonKey(reason: RejectionReason): TranslationKey {
  return REJECTION_REASON_KEYS[reason];
}

export function routeDecisionKey(result: ModelRouterResult): TranslationKey {
  if (!result.selectedModel) return "router.noCompatible";
  return result.fallbackModel ? "router.selectedWithFallback" : "router.selectedNoFallback";
}

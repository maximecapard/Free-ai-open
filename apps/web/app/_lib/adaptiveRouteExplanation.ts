import type { RouterReasonCode, RouterRejectionCode, RouterWarningCode } from "@free-ai-open/model-router";
import type { TranslationKey } from "../_i18n/dictionary";

// v0.7.0-alpha Phase 4: maps every adaptive router reason/warning/rejection
// code to a translation key, for the diagnostics surface (chat "Technical
// details" + /debug). Deliberately a separate `adaptiveRouter.*` namespace
// from the existing v0.6 `router.*` keys (routeExplanation.ts) — /debug still
// runs its own v0.6 preview call independently of the adaptive router, so
// those keys stay in place unchanged.
const REASON_KEYS: Record<RouterReasonCode, TranslationKey> = {
  manual_selection: "adaptiveRouter.reason.manual_selection",
  task_match: "adaptiveRouter.reason.task_match",
  language_match: "adaptiveRouter.reason.language_match",
  measured_stable: "adaptiveRouter.reason.measured_stable",
  measured_fast: "adaptiveRouter.reason.measured_fast",
  mobile_optimized: "adaptiveRouter.reason.mobile_optimized",
  cached_locally: "adaptiveRouter.reason.cached_locally",
  resource_margin: "adaptiveRouter.reason.resource_margin",
  performance_mode_match: "adaptiveRouter.reason.performance_mode_match",
  compatibility_fallback: "adaptiveRouter.reason.compatibility_fallback",
};

const WARNING_KEYS: Record<RouterWarningCode, TranslationKey> = {
  capability_schema_unsupported: "adaptiveRouter.warning.capability_schema_unsupported",
  capability_stale: "adaptiveRouter.warning.capability_stale",
  benchmark_missing: "adaptiveRouter.warning.benchmark_missing",
  benchmark_low_confidence: "adaptiveRouter.warning.benchmark_low_confidence",
  resource_unknown: "adaptiveRouter.warning.resource_unknown",
  previous_stall: "adaptiveRouter.warning.previous_stall",
  previous_oom: "adaptiveRouter.warning.previous_oom",
  previous_device_loss: "adaptiveRouter.warning.previous_device_loss",
  download_large: "adaptiveRouter.warning.download_large",
  performance_evidence_limited: "adaptiveRouter.warning.performance_evidence_limited",
  manual_model_unknown: "adaptiveRouter.warning.manual_model_unknown",
  manual_model_ineligible: "adaptiveRouter.warning.manual_model_ineligible",
  manual_choice_marginal: "adaptiveRouter.warning.manual_choice_marginal",
  registry_version_mismatch: "adaptiveRouter.warning.registry_version_mismatch",
  registry_invalid: "adaptiveRouter.warning.registry_invalid",
  no_eligible_model: "adaptiveRouter.warning.no_eligible_model",
};

const REJECTION_KEYS: Record<RouterRejectionCode, TranslationKey> = {
  model_not_verified: "adaptiveRouter.rejection.model_not_verified",
  backend_unavailable: "adaptiveRouter.rejection.backend_unavailable",
  fallback_adapter_unsupported: "adaptiveRouter.rejection.fallback_adapter_unsupported",
  required_feature_missing: "adaptiveRouter.rejection.required_feature_missing",
  required_limit_missing: "adaptiveRouter.rejection.required_limit_missing",
  insufficient_memory: "adaptiveRouter.rejection.insufficient_memory",
  form_factor_unsupported: "adaptiveRouter.rejection.form_factor_unsupported",
  task_unsupported: "adaptiveRouter.rejection.task_unsupported",
  metadata_incomplete: "adaptiveRouter.rejection.metadata_incomplete",
  repeated_oom: "adaptiveRouter.rejection.repeated_oom",
  repeated_stall: "adaptiveRouter.rejection.repeated_stall",
  repeated_device_loss: "adaptiveRouter.rejection.repeated_device_loss",
};

export function adaptiveReasonKey(code: RouterReasonCode): TranslationKey {
  return REASON_KEYS[code];
}

export function adaptiveWarningKey(code: RouterWarningCode): TranslationKey {
  return WARNING_KEYS[code];
}

export function adaptiveRejectionKey(code: RouterRejectionCode): TranslationKey {
  return REJECTION_KEYS[code];
}

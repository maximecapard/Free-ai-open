import { describe, expect, it } from "vitest";
import type { RouterReasonCode, RouterRejectionCode, RouterWarningCode } from "@free-ai-open/model-router";
import { adaptiveReasonKey, adaptiveRejectionKey, adaptiveWarningKey } from "./adaptiveRouteExplanation";
import { translateFromDictionary } from "../_i18n/dictionary";
import { en } from "../_i18n/locales/en";
import { fr } from "../_i18n/locales/fr";

const ALL_REASON_CODES: RouterReasonCode[] = [
  "manual_selection",
  "task_match",
  "language_match",
  "measured_stable",
  "measured_fast",
  "mobile_optimized",
  "cached_locally",
  "resource_margin",
  "performance_mode_match",
  "compatibility_fallback",
];

const ALL_WARNING_CODES: RouterWarningCode[] = [
  "capability_schema_unsupported",
  "capability_stale",
  "benchmark_missing",
  "benchmark_low_confidence",
  "resource_unknown",
  "previous_stall",
  "previous_oom",
  "previous_device_loss",
  "download_large",
  "performance_evidence_limited",
  "manual_model_unknown",
  "manual_model_ineligible",
  "manual_choice_marginal",
  "registry_version_mismatch",
  "registry_invalid",
  "no_eligible_model",
];

const ALL_REJECTION_CODES: RouterRejectionCode[] = [
  "model_not_verified",
  "backend_unavailable",
  "fallback_adapter_unsupported",
  "required_feature_missing",
  "required_limit_missing",
  "insufficient_memory",
  "form_factor_unsupported",
  "task_unsupported",
  "metadata_incomplete",
  "repeated_oom",
  "repeated_device_loss",
];

describe("adaptive router translation key mapping", () => {
  it("resolves every reason code to a non-empty EN and FR string", () => {
    for (const code of ALL_REASON_CODES) {
      const key = adaptiveReasonKey(code);
      expect(translateFromDictionary(en, en, key, undefined, { throwOnMissing: true })).toBeTruthy();
      expect(translateFromDictionary(fr, en, key, undefined, { throwOnMissing: true })).toBeTruthy();
    }
  });

  it("resolves every warning code to a non-empty EN and FR string", () => {
    for (const code of ALL_WARNING_CODES) {
      const key = adaptiveWarningKey(code);
      expect(translateFromDictionary(en, en, key, undefined, { throwOnMissing: true })).toBeTruthy();
      expect(translateFromDictionary(fr, en, key, undefined, { throwOnMissing: true })).toBeTruthy();
    }
  });

  it("resolves every rejection code to a non-empty EN and FR string", () => {
    for (const code of ALL_REJECTION_CODES) {
      const key = adaptiveRejectionKey(code);
      expect(translateFromDictionary(en, en, key, undefined, { throwOnMissing: true })).toBeTruthy();
      expect(translateFromDictionary(fr, en, key, undefined, { throwOnMissing: true })).toBeTruthy();
    }
  });
});

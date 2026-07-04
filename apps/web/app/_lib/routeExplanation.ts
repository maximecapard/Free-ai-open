import type { RejectionReason } from "@free-ai-open/model-router";

const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  model_blocked: "Currently blocked by the maintainers",
  task_not_supported: "Doesn't support this task",
  device_tier_too_low: "Needs a more capable device",
  backend_not_available: "Requires a runtime backend this browser doesn't have",
};

export function rejectionReasonLabel(reason: RejectionReason): string {
  return REJECTION_REASON_LABELS[reason];
}

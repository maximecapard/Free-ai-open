import type { RuntimeStatus } from "@free-ai-open/ai-runtime";
import type { TranslationKey } from "../_i18n/dictionary";

export interface ModelStatusContext {
  runtimeStatus: RuntimeStatus;
  isRoutingInProgress: boolean;
  isFallbackRetry: boolean;
  pendingModelSwitch: boolean;
}

// v0.7.0-alpha Phase 5: the mission's plain-language model states —
// Choosing a local model, Download required, Preparing the local model,
// Ready on this device, Trying a lighter model, Model unavailable. "Checking
// this device" is intentionally not modeled here: that step belongs to
// onboarding's own device-check screen, which already has dedicated copy.
const RUNTIME_STATUS_FALLBACK: Record<RuntimeStatus, TranslationKey> = {
  idle: "runtimeStatusPlain.idle",
  loading_model: "modelStatus.preparing",
  ready: "modelStatus.ready",
  generating: "runtimeStatusPlain.generating",
  cancelling: "runtimeStatusPlain.cancelling",
  recovering: "runtimeStatusPlain.recovering",
  error: "modelStatus.unavailable",
};

// Priority order below only matters while no model is actually usable yet —
// once chat works (ready/generating/cancelling), an in-progress background
// re-route or a pending upgrade offer must never make the status pill claim
// chat is blocked (see ModelDownloadConsent, which is where an upgrade offer
// is actually surfaced once a model is already usable).
export function resolveModelStatusKey(context: ModelStatusContext): TranslationKey {
  if (context.runtimeStatus === "loading_model") {
    return context.isFallbackRetry ? "modelStatus.tryingLighter" : "modelStatus.preparing";
  }
  if (context.runtimeStatus === "recovering") return "runtimeStatusPlain.recovering";
  if (context.runtimeStatus === "error") return "modelStatus.unavailable";

  const isUsable =
    context.runtimeStatus === "ready" || context.runtimeStatus === "generating" || context.runtimeStatus === "cancelling";

  if (!isUsable) {
    if (context.isRoutingInProgress) return "modelStatus.choosing";
    if (context.pendingModelSwitch) return "modelStatus.downloadRequired";
  }

  return RUNTIME_STATUS_FALLBACK[context.runtimeStatus];
}

import type { RouterReasonCode } from "@free-ai-open/model-router";
import type { TranslationKey } from "../_i18n/dictionary";

export interface FriendlyRouteExplanationContext {
  reasons: readonly RouterReasonCode[];
  taskLabel: string;
  localeLabel: string;
}

export interface FriendlyRouteExplanation {
  key: TranslationKey;
  params?: Record<string, string>;
}

// v0.7.0-alpha Phase 5: picks exactly one plain-language sentence for the
// normal chat surface ("Simple by default, technical on demand" — the full
// reason/warning list stays in the technical detail panel and /debug).
// Priority order: a fallback story is the most reassuring thing to tell a
// user first (it explains why the model just changed), then language match,
// then task fit, then device/speed signals, then "already on this device".
// taskLabel/localeLabel are already-translated display strings, matching the
// existing pattern (see chat/page.tsx's taskLabel) — this function never
// needs a translator itself, only chooses which key/params to hand one.
export function pickFriendlyRouteExplanation(context: FriendlyRouteExplanationContext): FriendlyRouteExplanation {
  const has = (code: RouterReasonCode) => context.reasons.includes(code);

  if (has("compatibility_fallback")) {
    return { key: "friendlyRoute.fallback" };
  }
  if (has("language_match")) {
    return { key: "friendlyRoute.language", params: { locale: context.localeLabel } };
  }
  if (has("task_match")) {
    return { key: "friendlyRoute.task", params: { task: context.taskLabel } };
  }
  if (has("measured_fast") || has("mobile_optimized")) {
    return { key: "friendlyRoute.fast" };
  }
  if (has("performance_mode_match") || has("measured_stable") || has("resource_margin")) {
    return { key: "friendlyRoute.deviceFit" };
  }
  if (has("cached_locally")) {
    return { key: "friendlyRoute.cached" };
  }
  return { key: "friendlyRoute.generic", params: { task: context.taskLabel } };
}

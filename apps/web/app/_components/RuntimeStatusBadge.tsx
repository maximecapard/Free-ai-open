"use client";

import type { RuntimeState } from "@free-ai-open/ai-runtime";
import { useTranslations } from "../_i18n/LocaleContext";
import type { TranslationKey } from "../_i18n/dictionary";

const STATUS_COLOR_VAR: Record<RuntimeState["status"], string> = {
  idle: "var(--fo-muted-500)",
  loading_model: "var(--fo-warning)",
  ready: "var(--fo-accent)",
  generating: "var(--fo-accent)",
  cancelling: "var(--fo-warning)",
  recovering: "var(--fo-warning)",
  error: "var(--fo-danger)",
};

export function RuntimeStatusBadge({ state }: { state: RuntimeState }) {
  const t = useTranslations();
  // Plain-language wording in the normal chat interface; raw status codes
  // stay in the debug dashboard's advanced/technical display only.
  const statusKey = `runtimeStatusPlain.${state.status}` as TranslationKey;
  const label =
    state.status === "loading_model" ? `${t(statusKey)} ${Math.round(state.loadProgress * 100)}%` : t(statusKey);

  return (
    <span className="fo-badge">
      <span className="fo-status-dot" style={{ background: STATUS_COLOR_VAR[state.status] }} />
      {label}
    </span>
  );
}

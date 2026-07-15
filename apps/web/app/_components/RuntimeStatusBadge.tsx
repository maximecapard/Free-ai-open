"use client";

import type { RuntimeState } from "@free-ai-open/ai-runtime";
import { useTranslations } from "../_i18n/LocaleContext";
import type { TranslationKey } from "../_i18n/dictionary";

const STATUS_COLOR_VAR: Record<RuntimeState["status"], string> = {
  idle: "var(--color-muted-dot)",
  loading_model: "var(--color-warning)",
  ready: "var(--color-success)",
  generating: "var(--color-success)",
  cancelling: "var(--color-warning)",
  recovering: "var(--color-warning)",
  error: "var(--color-danger)",
};

export function RuntimeStatusBadge({ state }: { state: RuntimeState }) {
  const t = useTranslations();
  const statusKey = `runtimeStatus.${state.status}` as TranslationKey;
  const label =
    state.status === "loading_model" ? `${t(statusKey)} ${Math.round(state.loadProgress * 100)}%` : t(statusKey);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        padding: "6px 12px",
        borderRadius: 999,
        border: "1px solid var(--color-border)",
        opacity: 0.85,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR_VAR[state.status] }} />
      {label}
    </span>
  );
}

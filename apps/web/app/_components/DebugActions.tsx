"use client";

import { useTranslations } from "../_i18n/LocaleContext";

const BUTTON_STYLE = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid var(--color-border)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontSize: 13,
};

export function DebugActions({
  onRefresh,
  onCopy,
  onDownload,
  onClear,
  statusMessage,
}: {
  onRefresh: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onClear: () => void;
  statusMessage: string | null;
}) {
  const t = useTranslations();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={BUTTON_STYLE} onClick={onRefresh}>
          {t("debug.refresh")}
        </button>
        <button style={BUTTON_STYLE} onClick={onCopy}>
          {t("debug.copyReport")}
        </button>
        <button style={BUTTON_STYLE} onClick={onDownload}>
          {t("debug.downloadReport")}
        </button>
        <button style={BUTTON_STYLE} onClick={onClear}>
          {t("debug.clearLogs")}
        </button>
      </div>
      {statusMessage && (
        <p role="status" aria-live="polite" style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>
          {statusMessage}
        </p>
      )}
    </div>
  );
}

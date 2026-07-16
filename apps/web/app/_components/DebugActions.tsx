"use client";

import { useTranslations } from "../_i18n/LocaleContext";

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
        <button className="fo-button fo-button-secondary" onClick={onRefresh}>
          {t("debug.refresh")}
        </button>
        <button className="fo-button fo-button-secondary" onClick={onCopy}>
          {t("debug.copyReport")}
        </button>
        <button className="fo-button fo-button-secondary" onClick={onDownload}>
          {t("debug.downloadReport")}
        </button>
        <button className="fo-button fo-button-secondary" onClick={onClear}>
          {t("debug.clearLogs")}
        </button>
      </div>
      {statusMessage && (
        <p role="status" aria-live="polite" className="fo-muted" style={{ fontSize: 13, margin: 0 }}>
          {statusMessage}
        </p>
      )}
    </div>
  );
}

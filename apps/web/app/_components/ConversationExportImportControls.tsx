"use client";

import { memo, useRef } from "react";
import { useTranslations } from "../_i18n/LocaleContext";

export interface ConversationImportSummary {
  importedCount: number;
  skippedCount: number;
  errors: string[];
}

export interface ConversationExportImportControlsProps {
  disabled: boolean;
  onExportActive: () => void;
  onExportAll: () => void;
  onImportFile: (file: File) => void;
  importSummary: ConversationImportSummary | null;
  onDismissImportSummary: () => void;
}

export const ConversationExportImportControls = memo(function ConversationExportImportControls({
  disabled,
  onExportActive,
  onExportAll,
  onImportFile,
  importSummary,
  onDismissImportSummary,
}: ConversationExportImportControlsProps) {
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImportFile(file);
  }

  const summaryText =
    importSummary && importSummary.importedCount === 0 && importSummary.skippedCount === 0
      ? t("backup.nothingToImport")
      : importSummary && importSummary.skippedCount > 0
        ? t("backup.importSummaryWithSkipped", {
            imported: importSummary.importedCount,
            skipped: importSummary.skippedCount,
          })
        : importSummary
          ? t("backup.importSummary", { imported: importSummary.importedCount })
          : "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        borderTop: "1px solid var(--color-border)",
        paddingTop: 12,
      }}
    >
      <strong style={{ fontSize: 12, opacity: 0.75 }}>{t("backup.title")}</strong>

      <div role="group" aria-label={t("history.exportConversations")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={onExportActive} disabled={disabled} style={{ fontSize: 12 }}>
          {t("backup.exportCurrent")}
        </button>
        <button type="button" onClick={onExportAll} disabled={disabled} style={{ fontSize: 12 }}>
          {t("backup.exportAll")}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          style={{ fontSize: 12 }}
        >
          {t("backup.import")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          aria-label={t("history.importConversations")}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

      <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>{t("backup.privacyNote")}</p>

      {importSummary && (
        <div
          role="status"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            padding: 8,
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{summaryText}</span>
            <button type="button" onClick={onDismissImportSummary} style={{ fontSize: 11 }}>
              {t("common.dismiss")}
            </button>
          </div>
          {importSummary.errors.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16, opacity: 0.75 }}>
              {importSummary.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});

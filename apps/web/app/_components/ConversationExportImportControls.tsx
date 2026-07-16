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
        borderTop: "1px solid var(--fo-border)",
        paddingTop: 12,
      }}
    >
      <p className="fo-technical-label" style={{ margin: 0 }}>
        {t("backup.title")}
      </p>

      <div role="group" aria-label={t("history.exportConversations")} className="conversation-export-actions">
        <button type="button" className="fo-button fo-button-secondary conversation-export-action" onClick={onExportActive} disabled={disabled}>
          {t("backup.exportCurrent")}
        </button>
        <button type="button" className="fo-button fo-button-secondary conversation-export-action" onClick={onExportAll} disabled={disabled}>
          {t("backup.exportAll")}
        </button>
        <button
          type="button"
          className="fo-button fo-button-secondary conversation-export-action"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
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

      <p className="fo-muted" style={{ fontSize: 11, margin: 0 }}>
        {t("backup.privacyNote")}
      </p>

      {importSummary && (
        <div role="status" className="fo-card" style={{ padding: 8, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{summaryText}</span>
            <button type="button" onClick={onDismissImportSummary} className="chat-history-action" style={{ fontSize: 11 }}>
              {t("common.dismiss")}
            </button>
          </div>
          {importSummary.errors.length > 0 && (
            <ul className="fo-muted" style={{ margin: 0, paddingLeft: 16 }}>
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

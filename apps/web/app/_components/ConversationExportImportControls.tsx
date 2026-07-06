"use client";

import { useRef } from "react";

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

export function ConversationExportImportControls({
  disabled,
  onExportActive,
  onExportAll,
  onImportFile,
  importSummary,
  onDismissImportSummary,
}: ConversationExportImportControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImportFile(file);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #333", paddingTop: 12 }}>
      <strong style={{ fontSize: 12, opacity: 0.75 }}>Backup</strong>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={onExportActive} disabled={disabled} style={{ fontSize: 12 }}>
          Export current
        </button>
        <button type="button" onClick={onExportAll} disabled={disabled} style={{ fontSize: 12 }}>
          Export all
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled} style={{ fontSize: 12 }}>
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

      <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>
        Exported files contain your conversation text — anyone with access to the file can read it. Exports are not
        encrypted, and no cloud sync is used: files stay on your device unless you share them yourself.
      </p>

      {importSummary && (
        <div
          style={{
            border: "1px solid #333",
            borderRadius: 10,
            padding: 8,
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>
              {importSummary.importedCount === 0 && importSummary.skippedCount === 0
                ? "Nothing to import in this file."
                : `Imported ${importSummary.importedCount}${
                    importSummary.skippedCount > 0 ? `, skipped ${importSummary.skippedCount}` : ""
                  }.`}
            </span>
            <button type="button" onClick={onDismissImportSummary} style={{ fontSize: 11 }}>
              Dismiss
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
}

const BUTTON_STYLE = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #333",
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={BUTTON_STYLE} onClick={onRefresh}>
          Refresh diagnostics
        </button>
        <button style={BUTTON_STYLE} onClick={onCopy}>
          Copy diagnostic report
        </button>
        <button style={BUTTON_STYLE} onClick={onDownload}>
          Download diagnostic report (JSON)
        </button>
        <button style={BUTTON_STYLE} onClick={onClear}>
          Clear local logs
        </button>
      </div>
      {statusMessage && <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>{statusMessage}</p>}
    </div>
  );
}

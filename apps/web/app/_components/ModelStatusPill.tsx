interface ModelStatusPillProps {
  taskLabel: string | null;
  modeLabel: string | null;
  modelName?: string | null;
}

export function ModelStatusPill({ taskLabel, modeLabel, modelName }: ModelStatusPillProps) {
  const label = !taskLabel || !modeLabel
    ? "No task selected"
    : modelName
      ? `${taskLabel} · ${modeLabel} · ${modelName} (not loaded)`
      : `${taskLabel} · ${modeLabel} · no compatible model found`;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        padding: "6px 12px",
        borderRadius: 999,
        border: "1px solid #333",
        opacity: 0.85,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#888" }} />
      {label}
    </span>
  );
}

import type { RuntimeState } from "@free-ai-open/ai-runtime";

const STATUS_LABEL: Record<RuntimeState["status"], string> = {
  idle: "Not started",
  loading_model: "Loading model",
  ready: "Ready",
  generating: "Generating",
  cancelling: "Stopping",
  error: "Error",
};

const STATUS_COLOR: Record<RuntimeState["status"], string> = {
  idle: "#888",
  loading_model: "#e5a53e",
  ready: "#3ecf8e",
  generating: "#3ecf8e",
  cancelling: "#e5a53e",
  error: "#e5484d",
};

export function RuntimeStatusBadge({ state }: { state: RuntimeState }) {
  const label =
    state.status === "loading_model"
      ? `${STATUS_LABEL.loading_model} ${Math.round(state.loadProgress * 100)}%`
      : STATUS_LABEL[state.status];

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
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[state.status] }} />
      {label}
    </span>
  );
}

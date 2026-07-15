import { useTranslations } from "../_i18n/LocaleContext";

interface ModelStatusPillProps {
  taskLabel: string | null;
  modeLabel: string | null;
  modelName?: string | null;
}

export function ModelStatusPill({ taskLabel, modeLabel, modelName }: ModelStatusPillProps) {
  const t = useTranslations();
  const label = !taskLabel || !modeLabel
    ? t("modelStatus.noTaskSelected")
    : modelName
      ? t("modelStatus.modelNotLoaded", { task: taskLabel, mode: modeLabel, model: modelName })
      : t("modelStatus.noCompatibleModel", { task: taskLabel, mode: modeLabel });

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
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-muted-dot)" }} />
      {label}
    </span>
  );
}

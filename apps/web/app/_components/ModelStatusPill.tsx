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
    <span className="fo-badge">
      <span className="fo-status-dot" />
      {label}
    </span>
  );
}

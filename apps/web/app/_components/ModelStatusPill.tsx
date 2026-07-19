import { useTranslations } from "../_i18n/LocaleContext";

interface ModelStatusPillProps {
  taskLabel: string | null;
  modeLabel: string | null;
  activeModelName?: string | null;
  recommendedModelName?: string | null;
}

export function ModelStatusPill({ taskLabel, modeLabel, activeModelName, recommendedModelName }: ModelStatusPillProps) {
  const t = useTranslations();
  const label = !taskLabel || !modeLabel
    ? t("modelStatus.noTaskSelected")
    : activeModelName
      ? t("modelStatus.activeModel", { task: taskLabel, mode: modeLabel, model: activeModelName })
      : recommendedModelName
        ? t("modelStatus.modelNotLoaded", { task: taskLabel, mode: modeLabel, model: recommendedModelName })
      : t("modelStatus.noCompatibleModel", { task: taskLabel, mode: modeLabel });

  return (
    <span className="fo-badge">
      <span className="fo-status-dot" />
      {label}
    </span>
  );
}

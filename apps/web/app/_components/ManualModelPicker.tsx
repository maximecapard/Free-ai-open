"use client";

import { useEffect, useState } from "react";
import { isModelCached } from "@free-ai-open/ai-runtime";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { RouterDecision } from "@free-ai-open/model-router";
import type { TaskCategory } from "@free-ai-open/types";
import type { ModelSelectionMode } from "../_lib/manualModelPreference";
import { resolveManualModelEligibility } from "../_lib/manualModelEligibility";
import { formatApproximateDownloadSize } from "../_lib/modelDownloadDisclosure";
import { adaptiveRejectionKey } from "../_lib/adaptiveRouteExplanation";
import { findTaskLabelKey } from "../_lib/catalog";
import { localizedModelName } from "../_lib/modelDisplayName";
import { useTranslations } from "../_i18n/LocaleContext";
import type { TranslationKey } from "../_i18n/dictionary";

export interface ManualModelPickerProps {
  registry: readonly ModelRegistryRecord[];
  routerDecision: RouterDecision | null;
  modelSelectionMode: ModelSelectionMode;
  manualModelId: string | null;
  disabled?: boolean;
  onSelectAutomatic: () => void;
  onSelectManual: (modelId: string) => void;
}

const LANGUAGE_LEVEL_KEYS: Record<ModelRegistryRecord["languages"]["en"], TranslationKey> = {
  strong: "manualModel.languageLevel.strong",
  usable: "manualModel.languageLevel.usable",
  limited: "manualModel.languageLevel.limited",
  unknown: "manualModel.languageLevel.unknown",
};

function recommendedTasks(record: ModelRegistryRecord): TaskCategory[] {
  return Object.entries(record.tasks)
    .filter(([, score]) => score >= 3)
    .map(([task]) => task as TaskCategory);
}

export function ManualModelPicker({
  registry,
  routerDecision,
  modelSelectionMode,
  manualModelId,
  disabled = false,
  onSelectAutomatic,
  onSelectManual,
}: ManualModelPickerProps) {
  const t = useTranslations();
  const [cachedByModelId, setCachedByModelId] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        registry.map(async (record) => [record.id, await isModelCached(record.webllmModelId)] as const)
      );
      if (!cancelled) setCachedByModelId(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [registry]);

  return (
    <div>
      <button
        type="button"
        className="fo-card"
        onClick={onSelectAutomatic}
        disabled={disabled}
        aria-pressed={modelSelectionMode === "automatic"}
        style={{
          display: "block",
          width: "100%",
          padding: 14,
          textAlign: "left",
          marginBottom: 12,
          borderColor: modelSelectionMode === "automatic" ? "var(--fo-accent)" : undefined,
          background: modelSelectionMode === "automatic" ? "var(--fo-accent-soft)" : undefined,
        }}
      >
        <strong>{t("manualModel.automaticTitle")}</strong>
        <p className="fo-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          {t("manualModel.automaticDescription")}
        </p>
      </button>

      <div style={{ display: "grid", gap: 12 }}>
        {registry.map((record) => {
          const isSelected = modelSelectionMode === "manual" && manualModelId === record.id;
          const eligibility = resolveManualModelEligibility(routerDecision, record.id);
          const size = formatApproximateDownloadSize(record.downloadSize.value);
          const cached = cachedByModelId[record.id] ?? false;
          const tasks = recommendedTasks(record);
          const isExperimental = record.status !== "verified";
          const displayName = localizedModelName(record, t);

          return (
            <div
              key={record.id}
              className="fo-card"
              style={{
                padding: 14,
                borderColor: isSelected ? "var(--fo-accent)" : undefined,
                background: isSelected ? "var(--fo-accent-soft)" : undefined,
              }}
            >
              {/* A <details> disclosure cannot legally nest inside a <button>
                  (interactive content inside interactive content), so the
                  selectable area and the technical-details disclosure are
                  siblings here rather than the details living inside the
                  button as in an earlier draft. */}
              <button
                type="button"
                onClick={() => onSelectManual(record.id)}
                disabled={disabled || !eligibility.eligible}
                aria-pressed={isSelected}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>{displayName}</strong>
                  <span className="fo-muted" style={{ fontSize: 13 }}>
                    {size ? `${size.value} ${size.unit}` : t("modelDownload.sizeUnknown")}
                    {cached ? ` · ${t("manualModel.cached")}` : ""}
                  </span>
                </div>
                <p className="fo-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                  {t(record.descriptionKey as TranslationKey)}
                </p>
              </button>

              {isExperimental && (
                <p className="fo-muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                  {t("manualModel.experimental")}
                </p>
              )}

              {!eligibility.eligible && (
                <p role="status" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--fo-text)" }}>
                  {eligibility.pending
                    ? t("manualModel.checkingEligibility")
                    : `${t("manualModel.ineligible")}: ${eligibility.rejectionReasons
                        .map((reason) => t(adaptiveRejectionKey(reason)))
                        .join(", ")}`}
                </p>
              )}

              <details style={{ marginTop: 8 }}>
                <summary className="fo-muted" style={{ cursor: "pointer", fontSize: 12, minHeight: 44, display: "flex", alignItems: "center" }}>
                  {t("onboarding.advancedDetails")}
                </summary>
                <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, auto) minmax(0, 1fr)", gap: "4px 12px", marginTop: 8 }}>
                  <dt className="fo-muted">{t("settings.modelId")}</dt>
                  <dd className="fo-technical-value">{record.webllmModelId}</dd>
                  <dt className="fo-muted">{t("manualModel.languagesLabel")}</dt>
                  <dd>
                    {t("manualModel.languageEn")}: {t(LANGUAGE_LEVEL_KEYS[record.languages.en])} · {t("manualModel.languageFr")}:{" "}
                    {t(LANGUAGE_LEVEL_KEYS[record.languages.fr])}
                  </dd>
                  <dt className="fo-muted">{t("manualModel.recommendedUsesLabel")}</dt>
                  <dd>
                    {tasks.length > 0
                      ? tasks.map((taskId) => (findTaskLabelKey(taskId) ? t(findTaskLabelKey(taskId) as TranslationKey) : taskId)).join(", ")
                      : t("manualModel.noRecommendedUses")}
                  </dd>
                  <dt className="fo-muted">{t("manualModel.deviceSuitabilityLabel")}</dt>
                  <dd>
                    {record.formFactors.mobile === 0 && record.formFactors.tablet === 0
                      ? t("manualModel.desktopOnly")
                      : t("manualModel.allDevices")}
                  </dd>
                </dl>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

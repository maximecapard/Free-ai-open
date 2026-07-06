"use client";

import type { ModelRecord } from "@free-ai-open/model-registry";
import { DebugField, DebugSection } from "./DebugSection";
import { useTranslations } from "../_i18n/LocaleContext";

function ModelDetails({ model }: { model: ModelRecord }) {
  const t = useTranslations();

  return (
    <>
      <DebugField label={t("debug.source")} value={model.source} />
      <DebugField label={t("debug.status")} value={model.status} />
      <DebugField label={t("debug.estimatedSize")} value={`${model.estimatedDownloadGb} GB`} />
      <DebugField label={t("debug.license")} value={model.license} />
    </>
  );
}

export function DebugModelSection({
  recommendedModel,
  loadedModelId,
  loadedModel,
}: {
  recommendedModel: ModelRecord | null;
  loadedModelId: string | null;
  loadedModel: ModelRecord | null;
}) {
  const t = useTranslations();

  return (
    <DebugSection title={t("debug.model")}>
      <DebugField
        label={t("debug.recommendedModelLabel")}
        value={recommendedModel ? recommendedModel.displayName : t("debug.noneAvailable")}
      />
      {recommendedModel && <ModelDetails model={recommendedModel} />}

      <div style={{ marginTop: 12 }}>
        <DebugField
          label={t("debug.loadedModel")}
          value={loadedModelId ? loadedModel?.displayName ?? loadedModelId : t("debug.noModelLoaded")}
        />
        {loadedModelId && loadedModel && <ModelDetails model={loadedModel} />}
        {loadedModelId && !loadedModel && (
          <p style={{ fontSize: 13, opacity: 0.6, margin: "6px 0 0" }}>{t("debug.notInRegistry")}</p>
        )}
      </div>
    </DebugSection>
  );
}

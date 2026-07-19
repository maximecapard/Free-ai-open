"use client";

import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import { DebugField, DebugSection } from "./DebugSection";
import { formatApproximateDownloadSize } from "../_lib/modelDownloadDisclosure";
import { localizedModelName } from "../_lib/modelDisplayName";
import { useTranslations } from "../_i18n/LocaleContext";

function ModelDetails({ model }: { model: ModelRegistryRecord }) {
  const t = useTranslations();
  const size = formatApproximateDownloadSize(model.downloadSize.value);

  return (
    <>
      <DebugField label={t("debug.source")} value={model.source.upstreamModelUrl} technical />
      <DebugField label={t("debug.status")} value={model.status} technical />
      <DebugField
        label={t("debug.estimatedSize")}
        value={size ? `${size.value} ${size.unit} (${model.downloadSize.confidence})` : t("common.unknown")}
        technical
      />
      <DebugField label={t("debug.license")} value={model.license.name} technical />
    </>
  );
}

export function DebugModelSection({
  recommendedModel,
  loadedModelId,
  loadedModel,
}: {
  recommendedModel: ModelRegistryRecord | null;
  loadedModelId: string | null;
  loadedModel: ModelRegistryRecord | null;
}) {
  const t = useTranslations();

  return (
    <DebugSection title={t("debug.model")}>
      <DebugField
        label={t("debug.recommendedModelLabel")}
        value={recommendedModel ? localizedModelName(recommendedModel, t) : t("debug.noneAvailable")}
      />
      {recommendedModel && <ModelDetails model={recommendedModel} />}

      <div style={{ marginTop: 12 }}>
        <DebugField
          label={t("debug.loadedModel")}
          value={loadedModelId ? (loadedModel ? localizedModelName(loadedModel, t) : loadedModelId) : t("debug.noModelLoaded")}
        />
        {loadedModelId && loadedModel && <ModelDetails model={loadedModel} />}
        {loadedModelId && !loadedModel && (
          <p className="fo-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
            {t("debug.notInRegistry")}
          </p>
        )}
      </div>
    </DebugSection>
  );
}

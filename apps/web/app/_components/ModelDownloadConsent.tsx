"use client";

import { modelRegistryV2 } from "@free-ai-open/model-registry";
import type { PendingModelSwitch } from "../_runtime/AppRuntimeProvider";
import { formatApproximateDownloadSize, isLargeMobileDownload } from "../_lib/modelDownloadDisclosure";
import { localizedModelName } from "../_lib/modelDisplayName";
import { useTranslations } from "../_i18n/LocaleContext";

export interface ModelDownloadConsentProps {
  pendingModelSwitch: PendingModelSwitch;
  onConfirm: () => void;
  onCancel: () => void;
}

// Shown before the first download of a non-default, not-yet-cached model —
// never starts a multi-gigabyte download solely because the router picked
// it. Discloses model name, approximate size, that it runs locally, and that
// the download may take time, per docs/privacy.md. Chat keeps working
// on the current model until (and unless) the user confirms.
export function ModelDownloadConsent({ pendingModelSwitch, onConfirm, onCancel }: ModelDownloadConsentProps) {
  const t = useTranslations();
  const size = formatApproximateDownloadSize(pendingModelSwitch.downloadSizeBytes);
  const sizeText = size ? `${size.value} ${size.unit}` : t("modelDownload.sizeUnknown");
  const showMobileWarning = isLargeMobileDownload(pendingModelSwitch.downloadSizeBytes, pendingModelSwitch.isMobileFormFactor);
  const record = modelRegistryV2.find((model) => model.id === pendingModelSwitch.registryId);
  const modelName = record ? localizedModelName(record, t) : pendingModelSwitch.displayName;

  return (
    <section role="region" aria-live="polite" aria-labelledby="model-download-consent-title" className="fo-inline-notice" style={{ marginBottom: 16 }}>
      <strong id="model-download-consent-title">{t("modelDownload.title")}</strong>
      <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--fo-text)" }}>
        {t("modelDownload.body", { model: modelName, size: sizeText })}
      </p>
      <p className="fo-muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
        {t(pendingModelSwitch.descriptionKey)}
      </p>
      {showMobileWarning && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: "var(--fo-text)" }}>
          {t("modelDownload.mobileWarning")}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="fo-button fo-button-primary" onClick={onConfirm}>
          {t("modelDownload.confirm")}
        </button>
        <button type="button" className="fo-button fo-button-secondary" onClick={onCancel}>
          {t("modelDownload.cancel")}
        </button>
      </div>
    </section>
  );
}

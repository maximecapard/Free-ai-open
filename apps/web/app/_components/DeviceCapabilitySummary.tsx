"use client";

import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { getDeviceTierDisplayLabel } from "@free-ai-open/device-profiler";
import { describeDeviceCapability } from "../_lib/deviceRecommendation";
import { useTranslations } from "../_i18n/LocaleContext";
import type { TranslationKey } from "../_i18n/dictionary";

const CAPABILITY_DETAIL_KEY: Record<ReturnType<typeof describeDeviceCapability>, TranslationKey> = {
  limited: "deviceCapability.limitedDetail",
  lightweight: "deviceCapability.lightweightDetail",
  recommended: "deviceCapability.recommendedDetail",
  highPerformance: "deviceCapability.highPerformanceDetail",
};

export function DeviceCapabilitySummary({ profile }: { profile: DeviceProfile | null }) {
  const t = useTranslations();

  if (!profile) {
    return <p className="fo-muted">{t("home.checkingDevice")}</p>;
  }

  const capability = describeDeviceCapability(profile.webgpuAvailable, profile.deviceTier);

  return (
    <div>
      <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontWeight: 650 }}>
        <span
          className="fo-status-dot"
          style={{ background: capability === "limited" ? "var(--fo-danger)" : "var(--fo-accent)" }}
        />
        {t(`deviceCapability.${capability}`)}
      </p>
      <p className="fo-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
        {t(CAPABILITY_DETAIL_KEY[capability])}
      </p>

      <details style={{ marginTop: 12, fontSize: 13 }}>
        <summary className="fo-muted" style={{ cursor: "pointer" }}>
          {t("onboarding.advancedDetails")}
        </summary>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginTop: 12 }}>
          <dt className="fo-muted">{t("onboarding.deviceTier")}</dt>
          <dd className="fo-technical-value">
            {profile.deviceTier} ({getDeviceTierDisplayLabel(profile.deviceTierLabel, profile.preferredBackend)})
          </dd>
          <dt className="fo-muted">{t("onboarding.preferredBackend")}</dt>
          <dd className="fo-technical-value">{profile.preferredBackend}</dd>
          <dt className="fo-muted">{t("onboarding.wasmAvailable")}</dt>
          <dd>{profile.wasmAvailable ? t("common.yes") : t("common.no")}</dd>
          <dt className="fo-muted">{t("onboarding.estimatedMemory")}</dt>
          <dd className="fo-technical-value">{profile.estimatedMemoryGb ? `${profile.estimatedMemoryGb} GB` : t("common.unknown")}</dd>
          <dt className="fo-muted">{t("onboarding.estimatedStorageQuota")}</dt>
          <dd className="fo-technical-value">{profile.storageQuotaGb ? `${profile.storageQuotaGb} GB` : t("common.unknown")}</dd>
          <dt className="fo-muted">{t("onboarding.browser")}</dt>
          <dd>{profile.browserFamily}</dd>
          <dt className="fo-muted">{t("onboarding.os")}</dt>
          <dd>{profile.osFamily}</dd>
        </dl>
      </details>
    </div>
  );
}

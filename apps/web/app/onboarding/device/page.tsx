"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { detectDeviceProfile, getDeviceTierDisplayLabel } from "@free-ai-open/device-profiler";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { findModeLabelKey } from "../../_lib/catalog";
import { recommendPerformanceMode } from "../../_lib/deviceRecommendation";
import { useTranslations } from "../../_i18n/LocaleContext";

export default function OnboardingDevicePage() {
  const t = useTranslations();
  const [profile, setProfile] = useState<DeviceProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    detectDeviceProfile().then((result) => {
      if (!cancelled) setProfile(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ opacity: 0.6, fontSize: 14 }}>{t("onboarding.step1")}</p>
      <h1 style={{ fontSize: 28, margin: "8px 0 24px" }}>{t("onboarding.deviceTitle")}</h1>

      {!profile ? (
        <p style={{ opacity: 0.7 }}>{t("onboarding.runningDeviceCheck")}</p>
      ) : (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: 16, borderRadius: 12, border: "1px solid var(--color-border)" }}>
              <strong>WebGPU</strong>
              <p style={{ margin: "6px 0 0", fontSize: 14, opacity: 0.8 }}>
                {profile.webgpuAvailable ? t("onboarding.webgpuAvailable") : t("onboarding.webgpuUnavailable")}
              </p>
            </div>
            <div style={{ padding: 16, borderRadius: 12, border: "1px solid var(--color-border)" }}>
              <strong>{t("onboarding.recommendedMode")}</strong>
              <p style={{ margin: "6px 0 0", fontSize: 14, opacity: 0.8 }}>
                {t("onboarding.recommendedModeBody", {
                  mode: t(findModeLabelKey(recommendPerformanceMode(profile.deviceTier)) ?? "modes.balanced.label"),
                })}
              </p>
            </div>
          </div>

          <details style={{ marginTop: 16, fontSize: 13, opacity: 0.75 }}>
            <summary style={{ cursor: "pointer" }}>{t("onboarding.advancedDetails")}</summary>
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginTop: 12 }}>
              <dt>{t("onboarding.deviceTier")}</dt>
              <dd>
                {profile.deviceTier} ({getDeviceTierDisplayLabel(profile.deviceTierLabel, profile.preferredBackend)})
              </dd>
              <dt>{t("onboarding.wasmAvailable")}</dt>
              <dd>{profile.wasmAvailable ? t("common.yes") : t("common.no")}</dd>
              <dt>{t("onboarding.preferredBackend")}</dt>
              <dd>{profile.preferredBackend}</dd>
              <dt>{t("onboarding.estimatedMemory")}</dt>
              <dd>{profile.estimatedMemoryGb ? `${profile.estimatedMemoryGb} GB` : t("common.unknown")}</dd>
              <dt>{t("onboarding.estimatedStorageQuota")}</dt>
              <dd>{profile.storageQuotaGb ? `${profile.storageQuotaGb} GB` : t("common.unknown")}</dd>
              <dt>{t("onboarding.browser")}</dt>
              <dd>{profile.browserFamily}</dd>
              <dt>{t("onboarding.os")}</dt>
              <dd>{profile.osFamily}</dd>
            </dl>
          </details>

          <Link
            href="/onboarding/task"
            className="fo-button fo-button-primary"
            style={{ marginTop: 32 }}
          >
            {t("common.continue")}
          </Link>
        </>
      )}

      <p style={{ marginTop: 32, fontSize: 13, opacity: 0.6 }}>{t("onboarding.devicePrivacy")}</p>
    </main>
  );
}

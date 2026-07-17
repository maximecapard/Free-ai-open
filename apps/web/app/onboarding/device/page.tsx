"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { DeviceCapabilitySummary } from "../../_components/DeviceCapabilitySummary";
import { detectAndStoreDeviceProfile } from "../../_lib/deviceProfileDetection";
import { useTranslations } from "../../_i18n/LocaleContext";

export default function OnboardingDevicePage() {
  const t = useTranslations();
  const [profile, setProfile] = useState<DeviceProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    detectAndStoreDeviceProfile().then((result) => {
      if (!cancelled) setProfile(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="fo-container-narrow" style={{ padding: "48px 0" }}>
      <p className="fo-technical-label">{t("onboarding.step1")}</p>
      <h1 className="fo-page-title" style={{ marginTop: 8 }}>
        {t("onboarding.deviceTitle")}
      </h1>

      <div className="fo-card" style={{ padding: 20, maxWidth: 480 }}>
        <DeviceCapabilitySummary profile={profile} />
      </div>

      {profile && (
        <Link href="/onboarding/mode" className="fo-button fo-button-primary" style={{ marginTop: 32 }}>
          {t("common.continue")}
        </Link>
      )}

      <p className="fo-muted" style={{ marginTop: 32, fontSize: 13 }}>
        {t("onboarding.devicePrivacy")}
      </p>
    </main>
  );
}

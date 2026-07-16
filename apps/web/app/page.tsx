"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { PrivacyNotice } from "./_components/PrivacyNotice";
import { DeviceCapabilitySummary } from "./_components/DeviceCapabilitySummary";
import { getRecommendedChatPath } from "./_lib/deviceRecommendation";
import { useTranslations } from "./_i18n/LocaleContext";

export default function HomePage() {
  const t = useTranslations();
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const recommendedChatPath = getRecommendedChatPath(profile);

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
    <main className="fo-container-narrow" style={{ padding: "64px 0" }}>
      <p className="fo-kicker">{t("home.kicker")}</p>
      <h1 className="fo-display">FreeAI Open</h1>
      <p style={{ fontSize: 20, lineHeight: 1.5, color: "var(--fo-text-muted)", maxWidth: 720 }}>{t("home.lead")}</p>

      <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
        {recommendedChatPath ? (
          <Link href={recommendedChatPath} className="fo-button fo-button-primary">
            {t("home.useRecommended")}
          </Link>
        ) : (
          <button type="button" className="fo-button fo-button-primary" disabled>
            {t("home.checkingRecommendation")}
          </button>
        )}
        <Link href="/onboarding" className="fo-button fo-button-secondary">
          {t("home.getStarted")}
        </Link>
      </div>

      <div className="fo-card" style={{ marginTop: 40, padding: 20, maxWidth: 480 }}>
        <p className="fo-technical-label">{t("home.statusHeading")}</p>
        <div style={{ marginTop: 8 }}>
          <DeviceCapabilitySummary profile={profile} />
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

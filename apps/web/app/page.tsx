"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { PrivacyNotice } from "./_components/PrivacyNotice";
import { DeviceCapabilitySummary } from "./_components/DeviceCapabilitySummary";
import { detectAndStoreDeviceProfile } from "./_lib/deviceProfileDetection";
import { isGettingStartedCompleted } from "./_lib/gettingStartedPreference";
import { useTranslations } from "./_i18n/LocaleContext";

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);

  // First-run gate: Getting Started is shown once, automatically, and never
  // again unless site data is cleared or the user resets it from Settings.
  useEffect(() => {
    const completed = isGettingStartedCompleted();
    setIsSetupComplete(completed);
    if (!completed) router.replace("/onboarding");
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    detectAndStoreDeviceProfile().then((result) => {
      if (!cancelled) setProfile(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isSetupComplete) return null;

  return (
    <main className="fo-container-narrow" style={{ padding: "64px 0" }}>
      <p className="fo-kicker">{t("home.kicker")}</p>
      <h1 className="fo-display">FreeAI Open</h1>
      <p style={{ fontSize: 20, lineHeight: 1.5, color: "var(--fo-text-muted)", maxWidth: 720 }}>{t("home.lead")}</p>

      <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
        <Link href="/chat" className="fo-button fo-button-primary">
          {t("home.openChat")}
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

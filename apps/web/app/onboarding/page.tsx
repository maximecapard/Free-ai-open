"use client";

import Link from "next/link";
import { PrivacyNotice } from "../_components/PrivacyNotice";
import { useTranslations } from "../_i18n/LocaleContext";

export default function OnboardingIntroPage() {
  const t = useTranslations();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 16 }}>{t("onboarding.introTitle")}</h1>
      <p style={{ fontSize: 17, lineHeight: 1.6, opacity: 0.85 }}>{t("onboarding.introBody")}</p>

      <Link
        href="/onboarding/device"
        style={{
          display: "inline-block",
          marginTop: 32,
          padding: "12px 20px",
          borderRadius: 12,
          background: "var(--color-text)",
          color: "var(--color-bg)",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        {t("common.continue")}
      </Link>

      <div style={{ marginTop: 40 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

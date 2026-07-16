"use client";

import Link from "next/link";
import { PrivacyNotice } from "../_components/PrivacyNotice";
import { useTranslations } from "../_i18n/LocaleContext";

export default function OnboardingIntroPage() {
  const t = useTranslations();

  return (
    <main className="fo-container-narrow" style={{ padding: "48px 0" }}>
      <h1 className="fo-page-title">{t("onboarding.introTitle")}</h1>
      <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--fo-text-muted)" }}>{t("onboarding.introBody")}</p>

      <Link href="/onboarding/device" className="fo-button fo-button-primary" style={{ marginTop: 32 }}>
        {t("common.continue")}
      </Link>

      <div style={{ marginTop: 40 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

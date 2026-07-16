"use client";

import Link from "next/link";
import { PrivacyNotice } from "./_components/PrivacyNotice";
import { useTranslations } from "./_i18n/LocaleContext";

export default function HomePage() {
  const t = useTranslations();

  return (
    <main className="fo-container-narrow" style={{ padding: "64px 0" }}>
      <p className="fo-kicker">{t("home.kicker")}</p>
      <h1 className="fo-display">FreeAI Open</h1>
      <p style={{ fontSize: 20, lineHeight: 1.5, color: "var(--fo-text-muted)", maxWidth: 720 }}>{t("home.lead")}</p>
      <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
        <Link href="/onboarding" className="fo-button fo-button-primary">
          {t("home.getStarted")}
        </Link>
        <Link href="/chat" className="fo-button fo-button-secondary">
          {t("home.skipToChat")}
        </Link>
      </div>
      <div style={{ marginTop: 40 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { PrivacyNotice } from "./_components/PrivacyNotice";
import { useTranslations } from "./_i18n/LocaleContext";

export default function HomePage() {
  const t = useTranslations();

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ opacity: 0.7 }}>{t("home.kicker")}</p>
      <h1 style={{ fontSize: 56, lineHeight: 1, margin: "16px 0" }}>FreeAI Open</h1>
      <p style={{ fontSize: 20, lineHeight: 1.5, opacity: 0.85 }}>{t("home.lead")}</p>
      <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
        <Link
          href="/onboarding"
          style={{
            padding: "12px 20px",
            borderRadius: 12,
            background: "var(--color-text)",
            color: "var(--color-bg)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {t("home.getStarted")}
        </Link>
        <Link
          href="/chat"
          style={{ padding: "12px 20px", borderRadius: 12, border: "1px solid var(--color-border)" }}
        >
          {t("home.skipToChat")}
        </Link>
      </div>
      <div style={{ marginTop: 40 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

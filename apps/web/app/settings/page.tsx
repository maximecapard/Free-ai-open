"use client";

import { useTranslations } from "../_i18n/LocaleContext";

export default function SettingsPage() {
  const t = useTranslations();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 16 }}>{t("settings.title")}</h1>
      <p style={{ opacity: 0.75, lineHeight: 1.6 }}>{t("settings.body")}</p>
    </main>
  );
}

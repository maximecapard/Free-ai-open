"use client";

import { useTranslations } from "../_i18n/LocaleContext";

export default function SettingsPage() {
  const t = useTranslations();

  return (
    <main className="fo-container-narrow" style={{ padding: "48px 0" }}>
      <h1 className="fo-page-title">{t("settings.title")}</h1>
      <p className="fo-muted" style={{ lineHeight: 1.6, fontSize: 16 }}>
        {t("settings.body")}
      </p>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useTranslations } from "../_i18n/LocaleContext";
import { LanguageToggle } from "../_i18n/LanguageToggle";
import { ThemeToggle } from "../_theme/ThemeToggle";

export function Header() {
  const t = useTranslations();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        maxWidth: 960,
        margin: "0 auto",
        padding: "20px 24px",
      }}
    >
      <Link href="/" style={{ fontWeight: 600, textDecoration: "none" }}>
        FreeAI Open
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <nav style={{ display: "flex", gap: 20, fontSize: 14, opacity: 0.8 }}>
          <Link href="/settings">{t("header.settings")}</Link>
          <Link href="/debug">{t("header.debug")}</Link>
        </nav>
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}

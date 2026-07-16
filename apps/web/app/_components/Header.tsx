"use client";

import Link from "next/link";
import { useTranslations } from "../_i18n/LocaleContext";
import { LanguageToggle } from "../_i18n/LanguageToggle";
import { ThemeToggle } from "../_theme/ThemeToggle";
import { BrandMark } from "./BrandMark";

export function Header() {
  const t = useTranslations();

  return (
    <header className="app-header">
      <Link href="/" className="app-header__brand">
        <BrandMark />
      </Link>
      <div className="app-header__controls">
        <nav className="app-nav">
          <Link href="/settings">{t("header.settings")}</Link>
          <Link href="/debug">{t("header.debug")}</Link>
        </nav>
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}

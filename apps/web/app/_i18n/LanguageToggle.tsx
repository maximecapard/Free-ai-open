"use client";

import { useLocale } from "./LocaleContext";
import { useTranslations } from "./LocaleContext";
import type { Locale } from "../_lib/localePreference";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "fr", label: "FR" },
];

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const t = useTranslations();

  return (
    <div role="group" aria-label={t("header.language")} className="fo-segmented">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={locale === option.value}
          onClick={() => setLocale(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useLocale } from "./LocaleContext";
import type { Locale } from "../_lib/localePreference";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "fr", label: "FR" },
];

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();

  return (
    <div role="group" aria-label="Language" style={{ display: "flex", gap: 4 }}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={locale === option.value}
          onClick={() => setLocale(option.value)}
          style={{
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: locale === option.value ? "var(--color-bg-elevated)" : "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

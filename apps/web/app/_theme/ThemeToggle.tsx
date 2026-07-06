"use client";

import { useTheme } from "./ThemeContext";
import { useTranslations } from "../_i18n/LocaleContext";
import type { ThemePreference } from "../_lib/themePreference";

const OPTIONS: { value: ThemePreference; labelKey: "header.themeSystem" | "header.themeLight" | "header.themeDark" }[] = [
  { value: "system", labelKey: "header.themeSystem" },
  { value: "light", labelKey: "header.themeLight" },
  { value: "dark", labelKey: "header.themeDark" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations();

  return (
    <div role="group" aria-label={t("header.theme")} style={{ display: "flex", gap: 4 }}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={theme === option.value}
          onClick={() => setTheme(option.value)}
          style={{
            fontSize: 12,
            padding: "4px 8px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: theme === option.value ? "var(--color-bg-elevated)" : "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  );
}

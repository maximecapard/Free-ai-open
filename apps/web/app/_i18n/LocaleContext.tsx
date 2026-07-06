"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { en } from "./locales/en";
import { fr } from "./locales/fr";
import { getByPath } from "./dictionary";
import type { Dictionary, TranslationKey } from "./dictionary";
import { detectBrowserLocale, getStoredLocale, setStoredLocale } from "../_lib/localePreference";
import type { Locale } from "../_lib/localePreference";

const DICTIONARIES: Record<Locale, Dictionary> = { en, fr };

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Starts at "en" on both server and first client render (no localStorage/
  // navigator access during SSR), then corrects itself right after mount.
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(getStoredLocale() ?? detectBrowserLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    setStoredLocale(next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within a LocaleProvider");
  return context;
}

export function useTranslations() {
  const { locale } = useLocale();

  return useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      const dictionary = DICTIONARIES[locale];
      const raw = getByPath(dictionary, key) ?? getByPath(en, key) ?? key;
      if (!params) return raw;
      return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), raw);
    },
    [locale]
  );
}

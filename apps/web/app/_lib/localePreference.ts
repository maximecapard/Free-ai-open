export type Locale = "en" | "fr";

const STORAGE_KEY = "free-ai-open:locale";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "fr";
}

export function getStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function setStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures (private browsing, quota, disabled storage).
  }
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const languages = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return languages.some((lang) => lang?.toLowerCase().startsWith("fr")) ? "fr" : "en";
}

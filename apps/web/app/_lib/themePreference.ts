export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "free-ai-open:theme";

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function getStoredTheme(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

export function setStoredTheme(theme: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures (private browsing, quota, disabled storage).
  }
}

export function applyThemeAttribute(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

// Inlined into layout.tsx as a raw <script> string (not imported) so it runs
// before hydration and avoids a flash of the wrong theme. Kept here as the
// single source of truth so the head script and the client provider agree on
// the storage key and the "system" = no attribute convention.
export const THEME_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem("${STORAGE_KEY}");if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v);}}catch(e){}})();`;

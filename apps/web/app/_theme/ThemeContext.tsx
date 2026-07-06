"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { applyThemeAttribute, getStoredTheme, setStoredTheme } from "../_lib/themePreference";
import type { ThemePreference } from "../_lib/themePreference";

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// useLayoutEffect (not useEffect) so the attribute is corrected before the
// browser paints the first client render, minimizing any visible flash.
// The blocking inline script in layout.tsx already applies the stored theme
// before hydration; this only needs to sync React state to match it (or to
// "system", which the script intentionally leaves unset).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");

  useIsomorphicLayoutEffect(() => {
    setThemeState(getStoredTheme() ?? "system");
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    setStoredTheme(next);
    applyThemeAttribute(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}

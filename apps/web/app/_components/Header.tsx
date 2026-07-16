"use client";

import { useEffect, useReducer, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { mobileNavMenuReducer } from "../_lib/mobileNavMenu";
import { useTranslations } from "../_i18n/LocaleContext";
import { LanguageToggle } from "../_i18n/LanguageToggle";
import { ThemeToggle } from "../_theme/ThemeToggle";
import { BrandMark } from "./BrandMark";
import { ChatIcon, DebugIcon, HomeIcon, MenuIcon, SettingsIcon } from "./icons";

interface NavLink {
  href: string;
  labelKey: "header.home" | "header.chat" | "header.settings" | "header.debug";
  icon: (props: { className?: string }) => React.JSX.Element;
}

const NAV_LINKS: NavLink[] = [
  { href: "/", labelKey: "header.home", icon: HomeIcon },
  { href: "/chat", labelKey: "header.chat", icon: ChatIcon },
  { href: "/settings", labelKey: "header.settings", icon: SettingsIcon },
  { href: "/debug", labelKey: "header.debug", icon: DebugIcon },
];

export function Header() {
  const t = useTranslations();
  const pathname = usePathname();
  const [isMenuOpen, dispatch] = useReducer(mobileNavMenuReducer, false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dispatch({ type: "close" });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      dispatch({ type: "close" });
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isMenuOpen]);

  // Closes the mobile menu on route changes so it never stays open behind a
  // newly navigated page.
  useEffect(() => {
    dispatch({ type: "close" });
  }, [pathname]);

  return (
    <>
      {/* Desktop: compact, always-Ink vertical rail. Mobile: hidden via CSS
          in favor of the fixed top bar below. Both render unconditionally so
          the breakpoint switch stays CSS-only, consistent with the rest of
          the app. */}
      <nav className="app-shell__rail" aria-label={t("header.primaryNavigation")}>
        <Link href="/" className="app-shell__rail-brand" aria-label="FreeAI Open">
          <BrandMark compact />
        </Link>
        <div className="app-shell__rail-nav">
          {NAV_LINKS.map((link) => {
            const isCurrent = link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="app-shell__rail-link"
                aria-current={isCurrent ? "page" : undefined}
              >
                <Icon className="app-shell__icon" />
                {t(link.labelKey)}
              </Link>
            );
          })}
        </div>
        <div className="app-shell__rail-footer">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </nav>

      <header className="app-shell__topbar">
        <Link href="/" className="app-shell__topbar-brand" aria-label="FreeAI Open">
          <BrandMark compact />
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className="app-shell__topbar-menu-button"
          aria-haspopup="true"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? t("header.closeMenu") : t("header.openMenu")}
          onClick={() => dispatch({ type: "toggle" })}
        >
          <MenuIcon className="app-shell__icon" />
        </button>
      </header>

      <div ref={menuRef} className={`app-shell__topbar-menu${isMenuOpen ? " is-open" : ""}`} inert={!isMenuOpen || undefined}>
        <nav className="app-shell__topbar-menu-nav" aria-label={t("header.primaryNavigation")}>
          {NAV_LINKS.map((link) => {
            const isCurrent = link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} aria-current={isCurrent ? "page" : undefined}>
                <Icon className="app-shell__icon" />
                {t(link.labelKey)}
              </Link>
            );
          })}
        </nav>
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </>
  );
}

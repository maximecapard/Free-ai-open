import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(new URL("../globals.css", import.meta.url), "utf8");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readDeclarations(selector: string): Map<string, string> {
  const match = globalsCss.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS selector: ${selector}`);

  const declarations = new Map<string, string>();
  for (const declaration of match[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) {
    declarations.set(declaration[1], declaration[2].trim());
  }
  return declarations;
}

function getThemeTokens(theme: "light" | "dark"): Map<string, string> {
  return new Map([...readDeclarations(":root"), ...readDeclarations(`:root[data-theme="${theme}"]`)]);
}

function resolveToken(tokens: Map<string, string>, token: string): string {
  const value = tokens.get(token);
  if (!value) throw new Error(`Missing CSS token: ${token}`);

  const variableMatch = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (variableMatch) return resolveToken(tokens, variableMatch[1]);
  return value;
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): RgbaColor {
  const hexMatch = value.match(/^#([a-f0-9]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgbaMatch = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/i);
  if (rgbaMatch) {
    return {
      r: Number(rgbaMatch[1]),
      g: Number(rgbaMatch[2]),
      b: Number(rgbaMatch[3]),
      a: Number(rgbaMatch[4]),
    };
  }

  throw new Error(`Unsupported color value: ${value}`);
}

function blend(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  if (foreground.a >= 1) return foreground;

  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function linearize(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: RgbaColor): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

function contrastRatio(foregroundValue: string, backgroundValue: string): number {
  const background = parseColor(backgroundValue);
  const foreground = blend(parseColor(foregroundValue), background);
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenContrast(theme: "light" | "dark", foregroundToken: string, backgroundToken: string): number {
  const tokens = getThemeTokens(theme);
  return contrastRatio(resolveToken(tokens, foregroundToken), resolveToken(tokens, backgroundToken));
}

describe("brand semantic contrast tokens", () => {
  it("meets WCAG AA contrast for core text pairs", () => {
    const pairs: Array<[theme: "light" | "dark", foreground: string, background: string]> = [
      ["light", "--fo-text", "--fo-bg"],
      ["light", "--fo-text-muted", "--fo-bg"],
      ["light", "--fo-text-muted", "--fo-surface"],
      ["light", "--fo-accent-text", "--fo-bg"],
      ["light", "--fo-accent-text", "--fo-surface"],
      ["dark", "--fo-text", "--fo-bg"],
      ["dark", "--fo-text-muted", "--fo-bg"],
      ["dark", "--fo-text-muted", "--fo-surface"],
    ];

    for (const [theme, foreground, background] of pairs) {
      expect(tokenContrast(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps visual teal separate from light-mode teal text", () => {
    const lightTokens = getThemeTokens("light");

    expect(resolveToken(lightTokens, "--fo-teal-500").toLowerCase()).toBe("#00d8ab");
    expect(resolveToken(lightTokens, "--fo-teal-700").toLowerCase()).toBe("#00a985");
    expect(resolveToken(lightTokens, "--fo-text-muted").toLowerCase()).toBe("#68707a");
    expect(resolveToken(lightTokens, "--fo-accent-text").toLowerCase()).toBe("#007e68");
  });
});

describe("mobile accessible controls", () => {
  it("defines 44px touch targets for mobile and coarse pointer controls", () => {
    const touchTargetMedia = globalsCss.slice(globalsCss.indexOf("@media (hover: none), (pointer: coarse), (max-width: 720px)"));

    for (const selector of [
      ".fo-segmented button",
      ".chat-history-title-button",
      ".chat-history-action",
      ".conversation-export-action",
      ".chat-history-trigger",
      ".chat-history-close",
    ]) {
      expect(touchTargetMedia).toContain(selector);
    }

    expect(touchTargetMedia).toContain("min-width: 44px");
    expect(touchTargetMedia).toContain("min-height: 44px");
  });

  it("keeps icon and history actions wired with accessible labels", () => {
    const header = readFileSync(new URL("../_components/Header.tsx", import.meta.url), "utf8");
    const drawerPanel = readFileSync(new URL("../_components/ChatHistoryDrawerPanel.tsx", import.meta.url), "utf8");
    const sidebar = readFileSync(new URL("../_components/ChatHistorySidebar.tsx", import.meta.url), "utf8");

    expect(header).toContain('aria-label={isMenuOpen ? t("header.closeMenu") : t("header.openMenu")}');
    expect(drawerPanel).toContain('aria-label={t("history.closeHistory")}');
    expect(sidebar).toContain('aria-label={`${t("common.rename")}: ${conversation.title}`}');
    expect(sidebar).toContain('aria-label={`${t("common.delete")}: ${conversation.title}`}');
    expect(sidebar).toContain("onClick={() => setPendingDeleteId(conversation.id)}");
    expect(sidebar).toContain("onClick={() => onDelete(conversation.id)}");
    expect(sidebar).toContain("onClick={() => setPendingDeleteId(null)}");
  });
});

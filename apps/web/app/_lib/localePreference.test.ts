import { afterEach, describe, expect, it } from "vitest";
import { detectBrowserLocale, getStoredLocale, setStoredLocale } from "./localePreference";

class MemoryLocalStorage {
  private readonly records = new Map<string, string>();

  getItem(key: string): string | null {
    return this.records.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.records.set(key, value);
  }
}

function installWindow(localStorage: MemoryLocalStorage): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
}

describe("locale preference", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "navigator");
  });

  it("persists and reads the selected UI language locally", () => {
    installWindow(new MemoryLocalStorage());

    setStoredLocale("fr");

    expect(getStoredLocale()).toBe("fr");
  });

  it("ignores invalid stored locales", () => {
    const storage = new MemoryLocalStorage();
    installWindow(storage);
    storage.setItem("free-ai-open:locale", "de");

    expect(getStoredLocale()).toBeNull();
  });

  it("detects French browser locales and falls back to English otherwise", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { languages: ["fr-FR"], language: "fr-FR" },
    });
    expect(detectBrowserLocale()).toBe("fr");

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { languages: ["en-US"], language: "en-US" },
    });
    expect(detectBrowserLocale()).toBe("en");
  });
});

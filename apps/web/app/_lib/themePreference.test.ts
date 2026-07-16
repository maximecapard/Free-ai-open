import { afterEach, describe, expect, it } from "vitest";
import { applyThemeAttribute, getStoredTheme, setStoredTheme } from "./themePreference";

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

function installDocument(): void {
  const attributes = new Map<string, string>();

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        getAttribute: (name: string) => attributes.get(name) ?? null,
        removeAttribute: (name: string) => {
          attributes.delete(name);
        },
        setAttribute: (name: string, value: string) => {
          attributes.set(name, value);
        },
      },
    },
  });
}

describe("theme preference", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("persists and reads the selected theme locally", () => {
    installWindow(new MemoryLocalStorage());

    setStoredTheme("light");

    expect(getStoredTheme()).toBe("light");
  });

  it("ignores invalid stored themes", () => {
    const storage = new MemoryLocalStorage();
    installWindow(storage);
    storage.setItem("free-ai-open:theme", "sepia");

    expect(getStoredTheme()).toBeNull();
  });

  it("applies light and dark themes while leaving system to the browser", () => {
    installDocument();

    applyThemeAttribute("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    applyThemeAttribute("system");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});

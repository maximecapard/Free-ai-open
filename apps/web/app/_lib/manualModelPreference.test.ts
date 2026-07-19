import { afterEach, describe, expect, it } from "vitest";
import { getStoredManualModelPreference, setAutomaticModelSelection, setManualModelSelection } from "./manualModelPreference";

class MemoryLocalStorage {
  private readonly records = new Map<string, string>();

  getItem(key: string): string | null {
    return this.records.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.records.set(key, value);
  }

  removeItem(key: string): void {
    this.records.delete(key);
  }
}

function installWindow(localStorage: MemoryLocalStorage): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
}

describe("manual model preference", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("defaults to automatic with no manual model before anything is stored", () => {
    installWindow(new MemoryLocalStorage());

    expect(getStoredManualModelPreference()).toEqual({ schemaVersion: 1, mode: "automatic", manualModelId: null });
  });

  it("persists a manual model selection", () => {
    installWindow(new MemoryLocalStorage());

    setManualModelSelection("qwen3-4b-q4f16");

    expect(getStoredManualModelPreference()).toEqual({
      schemaVersion: 1,
      mode: "manual",
      manualModelId: "qwen3-4b-q4f16",
    });
  });

  it("returns to automatic and clears the manual model id", () => {
    installWindow(new MemoryLocalStorage());

    setManualModelSelection("qwen3-4b-q4f16");
    setAutomaticModelSelection();

    expect(getStoredManualModelPreference()).toEqual({ schemaVersion: 1, mode: "automatic", manualModelId: null });
  });

  it("switching between manual models replaces the previous selection", () => {
    installWindow(new MemoryLocalStorage());

    setManualModelSelection("qwen3-0.6b-q4f16");
    setManualModelSelection("qwen2.5-coder-1.5b-q4f16");

    expect(getStoredManualModelPreference().manualModelId).toBe("qwen2.5-coder-1.5b-q4f16");
  });

  it("ignores a stored payload with an unexpected schema version", () => {
    const storage = new MemoryLocalStorage();
    installWindow(storage);
    storage.setItem(
      "free-ai-open:manual-model-preference",
      JSON.stringify({ schemaVersion: 999, mode: "manual", manualModelId: "qwen3-4b-q4f16" })
    );

    expect(getStoredManualModelPreference()).toEqual({ schemaVersion: 1, mode: "automatic", manualModelId: null });
  });

  it("ignores corrupted stored JSON", () => {
    const storage = new MemoryLocalStorage();
    installWindow(storage);
    storage.setItem("free-ai-open:manual-model-preference", "{not valid json");

    expect(getStoredManualModelPreference()).toEqual({ schemaVersion: 1, mode: "automatic", manualModelId: null });
  });

  it("falls back to automatic if a manual mode is stored without a model id", () => {
    const storage = new MemoryLocalStorage();
    installWindow(storage);
    storage.setItem("free-ai-open:manual-model-preference", JSON.stringify({ schemaVersion: 1, mode: "manual" }));

    expect(getStoredManualModelPreference()).toEqual({ schemaVersion: 1, mode: "automatic", manualModelId: null });
  });
});

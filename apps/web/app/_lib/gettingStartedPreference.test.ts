import { afterEach, describe, expect, it } from "vitest";
import {
  completeGettingStarted,
  getGettingStartedState,
  getStoredPerformanceMode,
  isGettingStartedCompleted,
  resetGettingStarted,
  setStoredPerformanceMode,
} from "./gettingStartedPreference";

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

describe("getting started preference", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("is not completed before anything is stored", () => {
    installWindow(new MemoryLocalStorage());

    expect(isGettingStartedCompleted()).toBe(false);
    expect(getStoredPerformanceMode()).toBeNull();
  });

  it("persists completion, the chosen performance mode, and schema version", () => {
    installWindow(new MemoryLocalStorage());

    completeGettingStarted("balanced", { deviceTier: 2, webgpuAvailable: true, formFactor: "desktop" });

    const state = getGettingStartedState();
    expect(state.completed).toBe(true);
    expect(state.performanceMode).toBe("balanced");
    expect(state.device).toEqual({ deviceTier: 2, webgpuAvailable: true, formFactor: "desktop" });
    expect(state.schemaVersion).toBe(1);
    expect(isGettingStartedCompleted()).toBe(true);
    expect(getStoredPerformanceMode()).toBe("balanced");
  });

  it("persists completion without device metadata when none is supplied", () => {
    installWindow(new MemoryLocalStorage());

    completeGettingStarted("fast");

    expect(getGettingStartedState().device).toBeNull();
  });

  it("updates the performance mode later without losing completion", () => {
    installWindow(new MemoryLocalStorage());

    completeGettingStarted("fast", { deviceTier: 0, webgpuAvailable: false, formFactor: "mobile" });
    setStoredPerformanceMode("performance");

    const state = getGettingStartedState();
    expect(state.completed).toBe(true);
    expect(state.performanceMode).toBe("performance");
    expect(state.device).toEqual({ deviceTier: 0, webgpuAvailable: false, formFactor: "mobile" });
  });

  it("clears completion and the stored mode on reset, so Getting Started shows again", () => {
    installWindow(new MemoryLocalStorage());

    completeGettingStarted("balanced", { deviceTier: 2, webgpuAvailable: true, formFactor: "desktop" });
    resetGettingStarted();

    expect(isGettingStartedCompleted()).toBe(false);
    expect(getStoredPerformanceMode()).toBeNull();
    expect(getGettingStartedState().device).toBeNull();
  });

  it("ignores a stored payload with an unexpected schema version", () => {
    const storage = new MemoryLocalStorage();
    installWindow(storage);
    storage.setItem("free-ai-open:getting-started", JSON.stringify({ schemaVersion: 999, completed: true }));

    expect(isGettingStartedCompleted()).toBe(false);
  });

  it("ignores corrupted stored JSON", () => {
    const storage = new MemoryLocalStorage();
    installWindow(storage);
    storage.setItem("free-ai-open:getting-started", "{not valid json");

    expect(isGettingStartedCompleted()).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredCapabilityProfile,
  getStoredCapabilityProfile,
  migrateStaticCapabilityProfile,
  setStoredCapabilityProfile,
} from "./capabilityProfileStore";

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
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
}

const exampleProfile = {
  schemaVersion: 1,
  detectedAt: "2026-07-17T10:00:00.000Z",
  formFactor: "desktop" as const,
  architectureClass: "x86" as const,
  browserFamily: "chrome",
  osFamily: "windows",
  webgpuAvailable: true,
  wasmAvailable: true,
  gpu: { featureClasses: [], limitClasses: {} },
  confidence: "medium" as const,
};

describe("capability profile store", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns null before anything is stored", () => {
    installWindow(new MemoryLocalStorage());
    expect(getStoredCapabilityProfile()).toBeNull();
  });

  it("persists and reads back a valid profile", () => {
    installWindow(new MemoryLocalStorage());
    setStoredCapabilityProfile(exampleProfile);
    expect(getStoredCapabilityProfile()).toEqual(exampleProfile);
  });

  it("migrates away a payload with the wrong schema version", () => {
    expect(migrateStaticCapabilityProfile({ ...exampleProfile, schemaVersion: 999 })).toBeNull();
  });

  it("migrates away a payload missing required fields", () => {
    expect(migrateStaticCapabilityProfile({ schemaVersion: 1 })).toBeNull();
  });

  it("migrates away corrupted or unrelated stored JSON", () => {
    const storage = new MemoryLocalStorage();
    installWindow(storage);
    storage.setItem("free-ai-open:capability-profile", "{not valid json");
    expect(getStoredCapabilityProfile()).toBeNull();
  });

  it("clears the stored profile", () => {
    installWindow(new MemoryLocalStorage());
    setStoredCapabilityProfile(exampleProfile);
    clearStoredCapabilityProfile();
    expect(getStoredCapabilityProfile()).toBeNull();
  });

  it("rejects a profile whose gpu field lost its coarse shape", () => {
    expect(migrateStaticCapabilityProfile({ ...exampleProfile, gpu: { vendorString: "NVIDIA GeForce RTX 4090" } })).toBeNull();
  });
});

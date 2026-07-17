import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredCapabilityProfile,
  getStoredCapabilityProfile,
  isCapabilityProfileExpired,
  migrateStaticCapabilityProfile,
  setStoredCapabilityProfile,
  shouldRedetectCapabilityProfile,
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
  schemaVersion: 2,
  detectedAt: "2026-07-17T10:00:00.000Z",
  expiresAt: "2026-07-24T10:00:00.000Z",
  formFactor: "desktop" as const,
  architectureClass: "x86" as const,
  browserFamily: "chrome",
  osFamily: "windows",
  memoryClass: "high" as const,
  logicalProcessorClass: "medium" as const,
  webgpuAvailable: true,
  wasmAvailable: true,
  capabilityClass: "performance" as const,
  deviceTier: 4 as const,
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

  it("migrates a schema v1 profile by adding v2 coarse fields", () => {
    const migrated = migrateStaticCapabilityProfile({
      schemaVersion: 1,
      detectedAt: "2026-07-17T10:00:00.000Z",
      formFactor: "desktop",
      architectureClass: "x86",
      browserFamily: "chrome",
      osFamily: "windows",
      approximateMemoryGB: 12,
      logicalProcessors: 10,
      webgpuAvailable: true,
      wasmAvailable: true,
      gpu: { featureClasses: ["shader-f16"], limitClasses: { maxBufferSize: 1073741824 } },
      confidence: "medium",
    });

    expect(migrated).toMatchObject({
      schemaVersion: 2,
      expiresAt: "2026-07-24T10:00:00.000Z",
      memoryClass: "high",
      logicalProcessorClass: "high",
      capabilityClass: "light",
      deviceTier: 1,
      gpu: { limitClasses: { maxBufferSize: "unknown" } },
    });
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

  it("rejects raw GPU identifiers even when the coarse shape is otherwise present", () => {
    expect(
      migrateStaticCapabilityProfile({
        ...exampleProfile,
        gpu: {
          ...exampleProfile.gpu,
          vendorString: "NVIDIA GeForce RTX 4090",
        },
      })
    ).toBeNull();
  });

  it("treats expired profiles as absent", () => {
    installWindow(new MemoryLocalStorage());
    setStoredCapabilityProfile(exampleProfile);
    expect(getStoredCapabilityProfile(() => new Date("2026-07-25T00:00:00.000Z"))).toBeNull();
    expect(isCapabilityProfileExpired(exampleProfile, () => new Date("2026-07-25T00:00:00.000Z"))).toBe(true);
  });

  it("redetects after expiry or browser family changes", () => {
    expect(shouldRedetectCapabilityProfile(null)).toBe(true);
    expect(
      shouldRedetectCapabilityProfile(exampleProfile, {
        now: () => new Date("2026-07-18T00:00:00.000Z"),
        browserFamily: "chrome",
        osFamily: "windows",
      })
    ).toBe(false);
    expect(shouldRedetectCapabilityProfile(exampleProfile, { browserFamily: "firefox" })).toBe(true);
    expect(shouldRedetectCapabilityProfile(exampleProfile, { now: () => new Date("2026-07-25T00:00:00.000Z") })).toBe(true);
  });
});

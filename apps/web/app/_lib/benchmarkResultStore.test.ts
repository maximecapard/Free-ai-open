import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredLocalBenchmarkResult,
  getStoredLocalBenchmarkResult,
  getStoredLocalBenchmarkForProfile,
  isLocalBenchmarkResultExpired,
  migrateLocalBenchmarkResult,
  setStoredLocalBenchmarkResult,
} from "./benchmarkResultStore";

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

const exampleResult = {
  schemaVersion: 2,
  benchmarkVersion: "1.0.0",
  capabilityProfileKey: "desktop:balanced:webgpu:native",
  measuredAt: "2026-07-17T10:00:00.000Z",
  expiresAt: "2026-07-24T10:00:00.000Z",
  status: "completed" as const,
  stage: "complete" as const,
  responsiveness: "responsive" as const,
  stability: "stable" as const,
  confidence: "medium" as const,
};

const profile = {
  formFactor: "desktop",
  capabilityClass: "balanced",
  webgpuAvailable: true,
  fallbackAdapter: false,
} as Parameters<typeof getStoredLocalBenchmarkForProfile>[0];

describe("local benchmark result store", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns null before anything is stored", () => {
    installWindow(new MemoryLocalStorage());
    expect(getStoredLocalBenchmarkResult()).toBeNull();
  });

  it("persists and reads back a valid, unexpired result", () => {
    installWindow(new MemoryLocalStorage());
    setStoredLocalBenchmarkResult(exampleResult);
    const now = () => new Date("2026-07-18T00:00:00.000Z");
    expect(getStoredLocalBenchmarkResult(now)).toEqual(exampleResult);
  });

  it("treats an expired result as absent", () => {
    installWindow(new MemoryLocalStorage());
    setStoredLocalBenchmarkResult(exampleResult);
    const afterExpiry = () => new Date("2026-08-01T00:00:00.000Z");
    expect(getStoredLocalBenchmarkResult(afterExpiry)).toBeNull();
  });

  it("computes expiry independently of storage", () => {
    expect(isLocalBenchmarkResultExpired(exampleResult, () => new Date("2026-07-18T00:00:00.000Z"))).toBe(false);
    expect(isLocalBenchmarkResultExpired(exampleResult, () => new Date("2026-08-01T00:00:00.000Z"))).toBe(true);
  });

  it("migrates away a payload with the wrong schema version", () => {
    expect(migrateLocalBenchmarkResult({ ...exampleResult, schemaVersion: 1 })).toBeNull();
  });

  it("invalidates a result when the coarse capability profile changes", () => {
    installWindow(new MemoryLocalStorage());
    setStoredLocalBenchmarkResult(exampleResult);
    const now = () => new Date("2026-07-18T00:00:00.000Z");
    expect(getStoredLocalBenchmarkForProfile(profile, now)).toEqual(exampleResult);
    expect(getStoredLocalBenchmarkForProfile({ ...profile, formFactor: "tablet" }, now)).toBeNull();
  });

  it("accepts a failed/unsupported result without numeric fields", () => {
    const failed = { ...exampleResult, status: "unsupported" as const, stability: "unknown" as const, confidence: "low" as const };
    expect(migrateLocalBenchmarkResult(failed)).toEqual(failed);
  });

  it("drops unexpected content-shaped fields during migration", () => {
    const migrated = migrateLocalBenchmarkResult({ ...exampleResult, prompt: "private text", response: "private output" });
    expect(migrated).toEqual(exampleResult);
    expect(migrated).not.toHaveProperty("prompt");
    expect(migrated).not.toHaveProperty("response");
  });

  it("clears the stored result", () => {
    installWindow(new MemoryLocalStorage());
    setStoredLocalBenchmarkResult(exampleResult);
    clearStoredLocalBenchmarkResult();
    expect(getStoredLocalBenchmarkResult()).toBeNull();
  });
});

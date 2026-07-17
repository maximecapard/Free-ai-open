import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredModelPerformanceObservations,
  getStoredModelPerformanceObservations,
  migrateModelPerformanceObservations,
  recordModelPerformanceObservation,
} from "./modelObservationStore";

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

function makeObservation(overrides: Partial<Parameters<typeof recordModelPerformanceObservation>[0]> = {}) {
  return {
    schemaVersion: 1 as const,
    modelId: "sample-general-light",
    observedAt: "2026-07-17T10:00:00.000Z",
    loadSucceeded: true,
    outcome: "completed" as const,
    ...overrides,
  };
}

describe("model performance observation store", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("starts empty", () => {
    installWindow(new MemoryLocalStorage());
    expect(getStoredModelPerformanceObservations()).toEqual([]);
  });

  it("records and reads back an observation", () => {
    installWindow(new MemoryLocalStorage());
    recordModelPerformanceObservation(makeObservation());
    expect(getStoredModelPerformanceObservations()).toHaveLength(1);
  });

  it("appends rather than overwriting prior observations", () => {
    installWindow(new MemoryLocalStorage());
    recordModelPerformanceObservation(makeObservation({ modelId: "model-a" }));
    recordModelPerformanceObservation(makeObservation({ modelId: "model-b" }));
    expect(getStoredModelPerformanceObservations().map((o) => o.modelId)).toEqual(["model-a", "model-b"]);
  });

  it("caps stored history, dropping the oldest entries first", () => {
    installWindow(new MemoryLocalStorage());
    for (let i = 0; i < 205; i++) {
      recordModelPerformanceObservation(makeObservation({ modelId: `model-${i}` }));
    }
    const stored = getStoredModelPerformanceObservations();
    expect(stored).toHaveLength(200);
    expect(stored[0]?.modelId).toBe("model-5");
    expect(stored.at(-1)?.modelId).toBe("model-204");
  });

  it("distinguishes a user cancellation from a real failure outcome", () => {
    installWindow(new MemoryLocalStorage());
    recordModelPerformanceObservation(makeObservation({ outcome: "cancelled" }));
    recordModelPerformanceObservation(makeObservation({ loadSucceeded: false, outcome: "load_failed" }));
    const [cancelled, failed] = getStoredModelPerformanceObservations();
    expect(cancelled?.outcome).toBe("cancelled");
    expect(failed?.outcome).toBe("load_failed");
  });

  it("drops entries with the wrong schema version or an invalid outcome instead of discarding the whole history", () => {
    const migrated = migrateModelPerformanceObservations([
      makeObservation(),
      { ...makeObservation(), schemaVersion: 2 },
      { ...makeObservation(), outcome: "not-a-real-outcome" },
      "not-an-object",
    ]);
    expect(migrated).toHaveLength(1);
  });

  it("migrates away non-array stored JSON", () => {
    expect(migrateModelPerformanceObservations({ not: "an array" })).toEqual([]);
  });

  it("clears stored observations", () => {
    installWindow(new MemoryLocalStorage());
    recordModelPerformanceObservation(makeObservation());
    clearStoredModelPerformanceObservations();
    expect(getStoredModelPerformanceObservations()).toEqual([]);
  });

  it("never contains prompt/response-shaped fields", () => {
    installWindow(new MemoryLocalStorage());
    recordModelPerformanceObservation(makeObservation());
    const serialized = JSON.stringify(getStoredModelPerformanceObservations()).toLowerCase();
    for (const forbidden of ["prompt", "response", "message", "conversation"]) {
      expect(serialized).not.toContain(`"${forbidden}`);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  clearStoredActiveConversationId,
  getStoredActiveConversationId,
  setStoredActiveConversationId,
} from "./activeConversationStorage";

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

  dump(): string {
    return JSON.stringify(Object.fromEntries(this.records));
  }
}

class ThrowingLocalStorage {
  getItem(): string | null {
    throw new Error("localStorage unavailable");
  }

  setItem(): void {
    throw new Error("localStorage unavailable");
  }

  removeItem(): void {
    throw new Error("localStorage unavailable");
  }
}

function installWindow(localStorage: MemoryLocalStorage | ThrowingLocalStorage): () => void {
  const hadWindow = "window" in globalThis;
  const previousWindow = hadWindow ? globalThis.window : undefined;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  return () => {
    if (hadWindow) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  };
}

describe("active conversation storage", () => {
  it("saves, reads, and clears only the active conversation ID pointer", () => {
    const storage = new MemoryLocalStorage();
    const restoreWindow = installWindow(storage);

    try {
      setStoredActiveConversationId("conversation-123");

      expect(getStoredActiveConversationId()).toBe("conversation-123");
      expect(storage.dump()).toContain("conversation-123");
      expect(storage.dump()).not.toContain("private prompt");
      expect(storage.dump()).not.toContain("private response");
      expect(storage.dump()).not.toContain("conversation message content");

      clearStoredActiveConversationId();

      expect(getStoredActiveConversationId()).toBeNull();
    } finally {
      restoreWindow();
    }
  });

  it("does not throw when localStorage is unavailable", () => {
    const restoreWindow = installWindow(new ThrowingLocalStorage());

    try {
      expect(() => setStoredActiveConversationId("conversation-123")).not.toThrow();
      expect(() => clearStoredActiveConversationId()).not.toThrow();
      expect(getStoredActiveConversationId()).toBeNull();
    } finally {
      restoreWindow();
    }
  });
});

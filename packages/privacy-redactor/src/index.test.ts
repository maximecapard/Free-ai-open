import { describe, expect, it } from "vitest";
import { redactString, redactTelemetryPayload } from "./index";

describe("redactString", () => {
  it("redacts email addresses", () => {
    expect(redactString("contact me at jane.doe@example.com")).toBe(
      "contact me at [REDACTED_EMAIL]"
    );
  });

  it("redacts API-key-like secrets", () => {
    expect(redactString("key sk-abcdefghijklmnop")).toBe("key [REDACTED_SECRET]");
  });

  it("redacts JWT-like tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactString(`token ${jwt}`)).toBe("token [REDACTED_JWT]");
  });

  it("truncates long strings to 2000 characters", () => {
    const long = "a".repeat(3000);
    expect(redactString(long)).toHaveLength(2000);
  });
});

describe("redactTelemetryPayload", () => {
  it("removes forbidden fields entirely", () => {
    const result = redactTelemetryPayload({
      event: "chat_completed",
      prompt: "what is the weather",
      apiKey: "sk-should-not-leak",
    }) as Record<string, unknown>;

    expect(result.prompt).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.apiKey).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.event).toBe("chat_completed");
  });

  it("recurses into nested objects and arrays", () => {
    const result = redactTelemetryPayload({
      items: [{ message: "hello there", contact: "a@b.com" }],
    }) as { items: Array<Record<string, unknown>> };

    expect(result.items[0].message).toBe("[FORBIDDEN_FIELD_REMOVED]");
    expect(result.items[0].contact).toBe("[REDACTED_EMAIL]");
  });

  it("redacts a forbidden field name at any nesting depth, not only at the top level", () => {
    const result = redactTelemetryPayload({
      metadata: { prompt: "leaked prompt content" },
    }) as { metadata: Record<string, unknown> };

    expect(result.metadata.prompt).toBe("[FORBIDDEN_FIELD_REMOVED]");
  });

  it("passes through primitives and null/undefined unchanged", () => {
    expect(redactTelemetryPayload(null)).toBeNull();
    expect(redactTelemetryPayload(undefined)).toBeUndefined();
    expect(redactTelemetryPayload(42)).toBe(42);
    expect(redactTelemetryPayload(true)).toBe(true);
  });
});

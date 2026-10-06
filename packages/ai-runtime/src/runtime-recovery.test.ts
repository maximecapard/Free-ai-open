import { describe, expect, it } from "vitest";
import { createRuntimeRecoveryResult, normalizeRuntimeRecoveryResult } from "./runtime-recovery";

describe("runtime recovery result", () => {
  it("keeps isolation and readiness as two independent facts", () => {
    expect(createRuntimeRecoveryResult(true, true)).toEqual({ isolated: true, ready: true });
    expect(createRuntimeRecoveryResult(true, false)).toEqual({ isolated: true, ready: false });
  });

  it("never reports ready for a runtime whose previous domain is not isolated", () => {
    expect(createRuntimeRecoveryResult(false, true)).toEqual({ isolated: false, ready: false });
    expect(normalizeRuntimeRecoveryResult({ isolated: false, ready: true })).toEqual({ isolated: false, ready: false });
  });

  it("fails closed for anything that is not a well-formed result", () => {
    for (const malformed of [true, false, null, undefined, 1, "ready", {}, { isolated: true }, { ready: true }, { isolated: "yes", ready: true }]) {
      expect(normalizeRuntimeRecoveryResult(malformed)).toEqual({ isolated: false, ready: false });
    }
  });

  it("passes a valid result through without exposing extra fields", () => {
    const normalized = normalizeRuntimeRecoveryResult({ isolated: true, ready: false, prompt: "LEAK_MARKER" });
    expect(normalized).toEqual({ isolated: true, ready: false });
    expect(JSON.stringify(normalized)).not.toContain("LEAK_MARKER");
  });
});

import { describe, expect, it } from "vitest";
import { resolveModelStatusKey } from "./modelStatusLabel";

const BASE = { runtimeStatus: "idle" as const, isRoutingInProgress: false, isFallbackRetry: false, pendingModelSwitch: false };

describe("resolveModelStatusKey", () => {
  it("shows 'choosing' while a routing decision is being computed and nothing is usable yet", () => {
    expect(resolveModelStatusKey({ ...BASE, isRoutingInProgress: true })).toBe("modelStatus.choosing");
  });

  it("shows 'download required' when consent is pending and nothing usable is loaded yet", () => {
    expect(resolveModelStatusKey({ ...BASE, pendingModelSwitch: true })).toBe("modelStatus.downloadRequired");
  });

  it("shows 'trying a lighter model' during a fallback attempt", () => {
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "loading_model", isFallbackRetry: true })).toBe(
      "modelStatus.tryingLighter"
    );
  });

  it("shows 'preparing' for a plain first-attempt load", () => {
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "loading_model" })).toBe("modelStatus.preparing");
  });

  it("keeps active loading progress ahead of a pending upgrade notice", () => {
    expect(
      resolveModelStatusKey({
        ...BASE,
        runtimeStatus: "loading_model",
        pendingModelSwitch: true,
        isRoutingInProgress: true,
      })
    ).toBe("modelStatus.preparing");
  });

  it("shows 'ready' once the model is usable", () => {
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "ready" })).toBe("modelStatus.ready");
  });

  it("shows 'unavailable' on error", () => {
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "error" })).toBe("modelStatus.unavailable");
  });

  it("never claims chat is blocked by a background re-route or pending upgrade once a model is usable", () => {
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "ready", isRoutingInProgress: true, pendingModelSwitch: true })).toBe(
      "modelStatus.ready"
    );
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "generating", pendingModelSwitch: true })).toBe(
      "runtimeStatusPlain.generating"
    );
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "cancelling", isRoutingInProgress: true })).toBe(
      "runtimeStatusPlain.cancelling"
    );
  });

  it("falls back to the existing plain runtime labels for idle/recovering", () => {
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "idle" })).toBe("runtimeStatusPlain.idle");
    expect(resolveModelStatusKey({ ...BASE, runtimeStatus: "recovering" })).toBe("runtimeStatusPlain.recovering");
  });
});

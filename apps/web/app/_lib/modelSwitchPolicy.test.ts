import { describe, expect, it } from "vitest";
import { isModelSwitchBlockedStatus, resolveModelSwitch } from "./modelSwitchPolicy";

describe("isModelSwitchBlockedStatus", () => {
  it("blocks while generating, cancelling, or recovering", () => {
    expect(isModelSwitchBlockedStatus("generating")).toBe(true);
    expect(isModelSwitchBlockedStatus("cancelling")).toBe(true);
    expect(isModelSwitchBlockedStatus("recovering")).toBe(true);
  });

  it("does not block when idle, loading, or ready", () => {
    expect(isModelSwitchBlockedStatus("idle")).toBe(false);
    expect(isModelSwitchBlockedStatus("loading_model")).toBe(false);
    expect(isModelSwitchBlockedStatus("ready")).toBe(false);
  });
});

describe("resolveModelSwitch", () => {
  it("does nothing when the selected model is already loaded", () => {
    expect(
      resolveModelSwitch({
        currentModelId: "qwen3-1.7b-q4f16",
        selectedModelId: "qwen3-1.7b-q4f16",
        runtimeStatus: "ready",
        isCached: false,
        isPreDisclosedDefault: false,
      })
    ).toEqual({ type: "noop" });
  });

  it("never interrupts an active generation, even for a cached or default model", () => {
    expect(
      resolveModelSwitch({
        currentModelId: "smollm2-360m-instruct-q4f32",
        selectedModelId: "qwen3-1.7b-q4f16",
        runtimeStatus: "generating",
        isCached: true,
        isPreDisclosedDefault: false,
      })
    ).toEqual({ type: "blocked_active_generation" });
  });

  it("switches immediately when the target model is already cached", () => {
    expect(
      resolveModelSwitch({
        currentModelId: "smollm2-360m-instruct-q4f32",
        selectedModelId: "qwen3-1.7b-q4f16",
        runtimeStatus: "ready",
        isCached: true,
        isPreDisclosedDefault: false,
      })
    ).toEqual({ type: "switch_now" });
  });

  it("switches immediately for the pre-disclosed default model even if not cached", () => {
    expect(
      resolveModelSwitch({
        currentModelId: "qwen3-1.7b-q4f16",
        selectedModelId: "smollm2-360m-instruct-q4f32",
        runtimeStatus: "ready",
        isCached: false,
        isPreDisclosedDefault: true,
      })
    ).toEqual({ type: "switch_now" });
  });

  it("requires consent for an uncached, non-default model", () => {
    expect(
      resolveModelSwitch({
        currentModelId: "smollm2-360m-instruct-q4f32",
        selectedModelId: "qwen3-4b-q4f16",
        runtimeStatus: "ready",
        isCached: false,
        isPreDisclosedDefault: false,
      })
    ).toEqual({ type: "needs_consent" });
  });

  it("requires consent even from a null (no model loaded yet) starting state", () => {
    expect(
      resolveModelSwitch({
        currentModelId: null,
        selectedModelId: "qwen3-4b-q4f16",
        runtimeStatus: "idle",
        isCached: false,
        isPreDisclosedDefault: false,
      })
    ).toEqual({ type: "needs_consent" });
  });

  it("does not ask again after the user declines the same download", () => {
    expect(
      resolveModelSwitch({
        currentModelId: "smollm2-360m-instruct-q4f32",
        selectedModelId: "qwen3-4b-q4f16",
        runtimeStatus: "ready",
        isCached: false,
        isDownloadDeclined: true,
        isPreDisclosedDefault: false,
      })
    ).toEqual({ type: "declined" });
  });
});

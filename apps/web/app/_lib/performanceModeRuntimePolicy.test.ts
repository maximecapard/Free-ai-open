import { describe, expect, it } from "vitest";
import {
  doesPerformanceModeRequireRuntimeReplacement,
  isPerformanceModeChangeBlockedStatus,
  resolvePerformanceModeChange,
} from "./performanceModeRuntimePolicy";

describe("performance mode runtime policy", () => {
  it("blocks performance changes while a response is active or being recovered", () => {
    expect(isPerformanceModeChangeBlockedStatus("generating")).toBe(true);
    expect(isPerformanceModeChangeBlockedStatus("cancelling")).toBe(true);
    expect(isPerformanceModeChangeBlockedStatus("recovering")).toBe(true);
    expect(
      resolvePerformanceModeChange({
        currentMode: "balanced",
        nextMode: "fast",
        runtimeStatus: "generating",
        runtimeLoaded: true,
        replacementRequired: false,
      })
    ).toEqual({ type: "blocked_active_generation" });
    expect(
      resolvePerformanceModeChange({
        currentMode: "balanced",
        nextMode: "performance",
        runtimeStatus: "generating",
        runtimeLoaded: true,
        replacementRequired: true,
      })
    ).toEqual({ type: "blocked_active_generation" });
  });

  it("persists without replacement for the v0.6.6-alpha placeholder model", () => {
    expect(doesPerformanceModeRequireRuntimeReplacement("balanced", "fast")).toBe(false);
    expect(
      resolvePerformanceModeChange({
        currentMode: "balanced",
        nextMode: "fast",
        runtimeStatus: "ready",
        runtimeLoaded: true,
        replacementRequired: doesPerformanceModeRequireRuntimeReplacement("balanced", "fast"),
      })
    ).toEqual({ type: "persist_only" });
  });

  it("selects safe runtime replacement when future model selection requires it", () => {
    expect(
      resolvePerformanceModeChange({
        currentMode: "fast",
        nextMode: "performance",
        runtimeStatus: "ready",
        runtimeLoaded: true,
        replacementRequired: true,
      })
    ).toEqual({ type: "replace_runtime" });
  });

  it("does nothing when the requested mode is already saved", () => {
    expect(
      resolvePerformanceModeChange({
        currentMode: "balanced",
        nextMode: "balanced",
        runtimeStatus: "ready",
        runtimeLoaded: true,
        replacementRequired: true,
      })
    ).toEqual({ type: "noop" });
  });
});

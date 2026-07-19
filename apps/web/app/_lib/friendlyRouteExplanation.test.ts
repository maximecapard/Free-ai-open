import { describe, expect, it } from "vitest";
import type { RouterReasonCode } from "@free-ai-open/model-router";
import { pickFriendlyRouteExplanation } from "./friendlyRouteExplanation";

function explain(reasons: RouterReasonCode[]) {
  return pickFriendlyRouteExplanation({ reasons, taskLabel: "Coding", localeLabel: "French" });
}

describe("pickFriendlyRouteExplanation", () => {
  it("prioritizes the fallback story above every other reason", () => {
    expect(explain(["compatibility_fallback", "language_match", "task_match"])).toEqual({
      key: "friendlyRoute.fallback",
    });
  });

  it("explains a language match with the translated locale label", () => {
    expect(explain(["language_match", "task_match"])).toEqual({
      key: "friendlyRoute.language",
      params: { locale: "French" },
    });
  });

  it("explains a task match with the translated task label", () => {
    expect(explain(["task_match", "cached_locally"])).toEqual({
      key: "friendlyRoute.task",
      params: { task: "Coding" },
    });
  });

  it("explains a speed-oriented pick for measured-fast or mobile-optimized reasons", () => {
    expect(explain(["measured_fast"])).toEqual({ key: "friendlyRoute.fast" });
    expect(explain(["mobile_optimized"])).toEqual({ key: "friendlyRoute.fast" });
  });

  it("explains a device-fit pick for performance-mode/measured-stable/resource-margin reasons", () => {
    expect(explain(["performance_mode_match"])).toEqual({ key: "friendlyRoute.deviceFit" });
    expect(explain(["measured_stable"])).toEqual({ key: "friendlyRoute.deviceFit" });
    expect(explain(["resource_margin"])).toEqual({ key: "friendlyRoute.deviceFit" });
  });

  it("explains a cached pick when nothing higher-priority is present", () => {
    expect(explain(["cached_locally"])).toEqual({ key: "friendlyRoute.cached" });
  });

  it("falls back to a generic task-based sentence for manual selection or no reasons", () => {
    expect(explain(["manual_selection"])).toEqual({ key: "friendlyRoute.generic", params: { task: "Coding" } });
    expect(explain([])).toEqual({ key: "friendlyRoute.generic", params: { task: "Coding" } });
  });
});

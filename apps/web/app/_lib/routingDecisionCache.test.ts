import { describe, expect, it } from "vitest";
import { buildObservationRevision, buildRoutingCacheKey, shouldRecomputeRouterDecision } from "./routingDecisionCache";
import type { RoutingCacheKeyInput } from "./routingDecisionCache";

const BASE_INPUT: RoutingCacheKeyInput = {
  task: "chat",
  locale: "en",
  performanceMode: "balanced",
  capabilityDetectedAt: "2026-07-01T00:00:00.000Z",
  benchmarkMeasuredAt: "2026-07-01T00:05:00.000Z",
  manualModelId: undefined,
  cachedModelIds: ["smollm2-360m-instruct-q4f32", "qwen3-0.6b-q4f16"],
  registryVersion: "0.7.0-alpha.1",
  currentModelRepeatedlyFailing: false,
  observationsRevision: "[]",
};

describe("routing decision cache key", () => {
  it("produces the same key for the same input", () => {
    expect(buildRoutingCacheKey(BASE_INPUT)).toBe(buildRoutingCacheKey({ ...BASE_INPUT }));
  });

  it("is insensitive to cachedModelIds ordering", () => {
    const reordered: RoutingCacheKeyInput = {
      ...BASE_INPUT,
      cachedModelIds: ["qwen3-0.6b-q4f16", "smollm2-360m-instruct-q4f32"],
    };
    expect(buildRoutingCacheKey(BASE_INPUT)).toBe(buildRoutingCacheKey(reordered));
  });

  it("changes when the task changes", () => {
    const next: RoutingCacheKeyInput = { ...BASE_INPUT, task: "coding" };
    expect(buildRoutingCacheKey(BASE_INPUT)).not.toBe(buildRoutingCacheKey(next));
  });

  it("changes when the performance mode changes", () => {
    const next: RoutingCacheKeyInput = { ...BASE_INPUT, performanceMode: "performance" };
    expect(buildRoutingCacheKey(BASE_INPUT)).not.toBe(buildRoutingCacheKey(next));
  });

  it("changes when the locale changes", () => {
    const next: RoutingCacheKeyInput = { ...BASE_INPUT, locale: "fr" };
    expect(buildRoutingCacheKey(BASE_INPUT)).not.toBe(buildRoutingCacheKey(next));
  });

  it("changes when the set of cached models changes", () => {
    const next: RoutingCacheKeyInput = { ...BASE_INPUT, cachedModelIds: ["smollm2-360m-instruct-q4f32"] };
    expect(buildRoutingCacheKey(BASE_INPUT)).not.toBe(buildRoutingCacheKey(next));
  });

  it("changes when the current model starts repeatedly failing", () => {
    const next: RoutingCacheKeyInput = { ...BASE_INPUT, currentModelRepeatedlyFailing: true };
    expect(buildRoutingCacheKey(BASE_INPUT)).not.toBe(buildRoutingCacheKey(next));
  });

  it("changes when a manual override is set or cleared", () => {
    const next: RoutingCacheKeyInput = { ...BASE_INPUT, manualModelId: "qwen3-4b-q4f16" };
    expect(buildRoutingCacheKey(BASE_INPUT)).not.toBe(buildRoutingCacheKey(next));
  });

  it("changes whenever a technical observation changes", () => {
    const next: RoutingCacheKeyInput = { ...BASE_INPUT, observationsRevision: "[[\"model-a\",\"completed\"]]" };
    expect(buildRoutingCacheKey(BASE_INPUT)).not.toBe(buildRoutingCacheKey(next));
  });
});

describe("buildObservationRevision", () => {
  it("uses only allowlisted technical observation fields", () => {
    const revision = buildObservationRevision([
      {
        schemaVersion: 1,
        modelId: "model-a",
        observedAt: "2026-07-18T00:00:00.000Z",
        loadSucceeded: true,
        outcome: "completed",
        prompt: "private prompt",
      } as never,
    ]);
    expect(revision).toContain("model-a");
    expect(revision).not.toContain("private prompt");
    expect(revision).not.toContain("prompt");
  });
});

describe("shouldRecomputeRouterDecision", () => {
  it("recomputes when there is no previous decision", () => {
    expect(shouldRecomputeRouterDecision(null, "key-a")).toBe(true);
  });

  it("does not recompute when the key is unchanged", () => {
    expect(shouldRecomputeRouterDecision("key-a", "key-a")).toBe(false);
  });

  it("recomputes when the key changed", () => {
    expect(shouldRecomputeRouterDecision("key-a", "key-b")).toBe(true);
  });
});

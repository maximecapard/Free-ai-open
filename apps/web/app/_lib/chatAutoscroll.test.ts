import { describe, expect, it } from "vitest";
import { CHAT_AUTOSCROLL_BOTTOM_THRESHOLD_PX, isNearScrollEnd } from "./chatAutoscroll";

describe("chat autoscroll", () => {
  it("follows the latest message when the viewport is near the bottom", () => {
    expect(
      isNearScrollEnd({
        scrollTop: 780,
        viewportHeight: 600,
        scrollHeight: 1_500,
      })
    ).toBe(true);
  });

  it("does not force scroll when the user has moved away from the bottom", () => {
    expect(
      isNearScrollEnd({
        scrollTop: 200,
        viewportHeight: 600,
        scrollHeight: 1_500,
      })
    ).toBe(false);
  });

  it("treats short transcripts as already at the bottom", () => {
    expect(
      isNearScrollEnd({
        scrollTop: 0,
        viewportHeight: 800,
        scrollHeight: 600,
      })
    ).toBe(true);
  });

  it("allows a smaller threshold for exact boundary tests", () => {
    expect(
      isNearScrollEnd({
        scrollTop: 850,
        viewportHeight: 600,
        scrollHeight: 1_500,
        thresholdPx: 49,
      })
    ).toBe(false);
    expect(
      isNearScrollEnd({
        scrollTop: 850,
        viewportHeight: 600,
        scrollHeight: 1_500,
        thresholdPx: 50,
      })
    ).toBe(true);
    expect(CHAT_AUTOSCROLL_BOTTOM_THRESHOLD_PX).toBeGreaterThanOrEqual(80);
  });
});

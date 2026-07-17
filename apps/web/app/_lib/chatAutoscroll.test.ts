import { describe, expect, it } from "vitest";
import {
  CHAT_AUTOSCROLL_BOTTOM_THRESHOLD_PX,
  getElementScrollMetrics,
  isNearScrollEnd,
  isScrollableOverflow,
} from "./chatAutoscroll";

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

  it("reads scroll metrics from an independently scrolling transcript container", () => {
    const element = {
      scrollTop: 360,
      clientHeight: 500,
      scrollHeight: 900,
    } as HTMLElement;

    expect(getElementScrollMetrics(element)).toEqual({
      scrollTop: 360,
      viewportHeight: 500,
      scrollHeight: 900,
    });
    expect(isNearScrollEnd(getElementScrollMetrics(element))).toBe(true);
  });

  it("detects element overflow modes that can own transcript scrolling", () => {
    expect(isScrollableOverflow("auto")).toBe(true);
    expect(isScrollableOverflow("scroll")).toBe(true);
    expect(isScrollableOverflow("overlay")).toBe(true);
    expect(isScrollableOverflow("visible")).toBe(false);
    expect(isScrollableOverflow("hidden")).toBe(false);
  });
});

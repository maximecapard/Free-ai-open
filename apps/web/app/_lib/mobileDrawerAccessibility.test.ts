import { describe, expect, it } from "vitest";
import {
  focusMobileDrawer,
  isolateMobileDrawerBackground,
  restoreMobileDrawerTriggerFocus,
  shouldRedirectFocusToDrawer,
} from "./mobileDrawerAccessibility";

function focusTarget(name: string, calls: string[]) {
  return {
    focus: () => calls.push(name),
  };
}

function backgroundTarget(options: { inertSupported: boolean; inert?: boolean; ariaHidden?: string } = { inertSupported: true }): {
  inert?: boolean;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
} {
  const attributes = new Map<string, string>();
  if (options.ariaHidden !== undefined) attributes.set("aria-hidden", options.ariaHidden);

  const base = {
    hasAttribute: (name: string) => attributes.has(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };

  return options.inertSupported ? { ...base, inert: options.inert ?? false } : base;
}

describe("mobile drawer accessibility helpers", () => {
  it("focuses the close button when the drawer opens", () => {
    const calls: string[] = [];

    focusMobileDrawer(focusTarget("close", calls), focusTarget("panel", calls));

    expect(calls).toEqual(["close"]);
  });

  it("falls back to the panel when the close button is unavailable", () => {
    const calls: string[] = [];

    focusMobileDrawer(null, focusTarget("panel", calls));

    expect(calls).toEqual(["panel"]);
  });

  it("restores focus to the trigger when the drawer closes", () => {
    const calls: string[] = [];

    restoreMobileDrawerTriggerFocus(focusTarget("trigger", calls));

    expect(calls).toEqual(["trigger"]);
  });

  it("marks the background inert while the drawer is open and restores it on cleanup", () => {
    const background = backgroundTarget({ inertSupported: true, inert: false });

    const cleanup = isolateMobileDrawerBackground(background);

    expect(background.inert).toBe(true);
    cleanup();
    expect(background.inert).toBe(false);
    expect(background.hasAttribute("aria-hidden")).toBe(false);
  });

  it("restores a previous inert background state", () => {
    const background = backgroundTarget({ inertSupported: true, inert: true });

    const cleanup = isolateMobileDrawerBackground(background);

    expect(background.inert).toBe(true);
    cleanup();
    expect(background.inert).toBe(true);
  });

  it("uses aria-hidden as a fallback when inert is unavailable and restores the previous state", () => {
    const background = backgroundTarget({ inertSupported: false, ariaHidden: "false" });

    const cleanup = isolateMobileDrawerBackground(background);

    expect(background.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    expect(background.getAttribute("aria-hidden")).toBe("false");
  });

  it("removes fallback aria-hidden on cleanup when it was not present before", () => {
    const background = backgroundTarget({ inertSupported: false });

    const cleanup = isolateMobileDrawerBackground(background);

    expect(background.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    expect(background.hasAttribute("aria-hidden")).toBe(false);
  });

  it("redirects focus attempts that leave the drawer", () => {
    const insideTarget = {} as Node;
    const outsideTarget = {} as Node;
    const panel = {
      contains: (target: Node | null) => target === insideTarget,
    };

    expect(shouldRedirectFocusToDrawer(panel, insideTarget)).toBe(false);
    expect(shouldRedirectFocusToDrawer(panel, outsideTarget)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { mobileNavMenuReducer } from "./mobileNavMenu";

describe("mobile nav menu reducer", () => {
  it("starts closed and opens on open", () => {
    expect(mobileNavMenuReducer(false, { type: "open" })).toBe(true);
  });

  it("stays open when opened again", () => {
    expect(mobileNavMenuReducer(true, { type: "open" })).toBe(true);
  });

  it("closes on the close action", () => {
    expect(mobileNavMenuReducer(true, { type: "close" })).toBe(false);
  });

  it("stays closed when already closed and closed again", () => {
    expect(mobileNavMenuReducer(false, { type: "close" })).toBe(false);
  });

  it("toggles open and closed", () => {
    expect(mobileNavMenuReducer(false, { type: "toggle" })).toBe(true);
    expect(mobileNavMenuReducer(true, { type: "toggle" })).toBe(false);
  });
});

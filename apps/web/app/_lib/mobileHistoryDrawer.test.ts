import { describe, expect, it } from "vitest";
import { mobileHistoryDrawerReducer } from "./mobileHistoryDrawer";

describe("mobile history drawer reducer", () => {
  it("starts closed and opens on open", () => {
    expect(mobileHistoryDrawerReducer(false, { type: "open" })).toBe(true);
  });

  it("stays open when opened again", () => {
    expect(mobileHistoryDrawerReducer(true, { type: "open" })).toBe(true);
  });

  it("closes on the close action", () => {
    expect(mobileHistoryDrawerReducer(true, { type: "close" })).toBe(false);
  });

  it("closes automatically when a conversation is selected", () => {
    expect(mobileHistoryDrawerReducer(true, { type: "select-conversation" })).toBe(false);
  });

  it("closes automatically when a new chat is started", () => {
    expect(mobileHistoryDrawerReducer(true, { type: "new-chat" })).toBe(false);
  });

  it("closes on Escape", () => {
    expect(mobileHistoryDrawerReducer(true, { type: "escape" })).toBe(false);
  });

  it("closes on a backdrop click", () => {
    expect(mobileHistoryDrawerReducer(true, { type: "backdrop-click" })).toBe(false);
  });

  it("closes when the viewport becomes desktop-sized", () => {
    expect(mobileHistoryDrawerReducer(true, { type: "viewport-desktop" })).toBe(false);
  });

  it("stays closed when already closed and a closing action fires again", () => {
    expect(mobileHistoryDrawerReducer(false, { type: "close" })).toBe(false);
    expect(mobileHistoryDrawerReducer(false, { type: "select-conversation" })).toBe(false);
  });
});

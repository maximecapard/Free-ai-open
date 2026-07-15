import { describe, expect, it } from "vitest";
import { canSendChatMessage, isConversationSwitchBlockedStatus } from "./runtimeUiState";

describe("runtime UI state decisions", () => {
  it("blocks sending while cancelling or recovering", () => {
    expect(canSendChatMessage("ready", "hello")).toBe(true);
    expect(canSendChatMessage("ready", "   ")).toBe(false);
    expect(canSendChatMessage("generating", "hello")).toBe(false);
    expect(canSendChatMessage("cancelling", "hello")).toBe(false);
    expect(canSendChatMessage("recovering", "hello")).toBe(false);
    expect(canSendChatMessage("error", "hello")).toBe(false);
  });

  it("blocks conversation switches during generation, cancellation, and recovery", () => {
    expect(isConversationSwitchBlockedStatus("ready")).toBe(false);
    expect(isConversationSwitchBlockedStatus("generating")).toBe(true);
    expect(isConversationSwitchBlockedStatus("cancelling")).toBe(true);
    expect(isConversationSwitchBlockedStatus("recovering")).toBe(true);
  });
});

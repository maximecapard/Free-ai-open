import { describe, expect, it } from "vitest";
import {
  generationNoticeKey,
  isIncompleteAssistantOutput,
  shouldDiscardPartialAssistantOutput,
  shouldPersistAssistantOutput,
} from "./generationPersistence";

describe("generation persistence decisions", () => {
  it("persists only completed assistant output", () => {
    expect(shouldPersistAssistantOutput("completed", "normal reply")).toBe(true);
    expect(shouldPersistAssistantOutput("completed", "")).toBe(false);
    expect(shouldPersistAssistantOutput(null, "partial reply", "generation_stalled")).toBe(true);
    expect(shouldPersistAssistantOutput(null, "partial reply", "generation_exceeded_safety_limit")).toBe(true);
  });

  it("does not save cancelled assistant output as a completed reply", () => {
    expect(shouldDiscardPartialAssistantOutput("cancelled")).toBe(true);
    expect(generationNoticeKey("cancelled")).toBe("storageNotice.generationStopped");
  });

  it("does not save degenerate assistant output as a completed reply", () => {
    expect(shouldDiscardPartialAssistantOutput("degenerate_output")).toBe(true);
    expect(generationNoticeKey("degenerate_output")).toBe("storageNotice.generationUnstable");
  });

  it("discards a stall/safety-limit interruption that produced no output at all", () => {
    expect(shouldDiscardPartialAssistantOutput(null, "generation_stalled")).toBe(true);
    expect(shouldDiscardPartialAssistantOutput(null, "generation_exceeded_safety_limit")).toBe(true);
    expect(generationNoticeKey(null, "generation_stalled")).toBe("storageNotice.generationTimedOut");
    expect(generationNoticeKey(null, "generation_exceeded_safety_limit")).toBe("storageNotice.generationSafetyLimit");
  });

  it("preserves partial output from a genuine stall or safety-limit interruption instead of discarding it", () => {
    expect(shouldDiscardPartialAssistantOutput(null, "generation_stalled", true)).toBe(false);
    expect(shouldDiscardPartialAssistantOutput(null, "generation_exceeded_safety_limit", true)).toBe(false);
    expect(generationNoticeKey(null, "generation_stalled", true)).toBe("storageNotice.generationIncomplete");
    expect(generationNoticeKey(null, "generation_exceeded_safety_limit", true)).toBe(
      "storageNotice.generationSafetyLimitIncomplete"
    );
    expect(isIncompleteAssistantOutput("generation_stalled", true)).toBe(true);
    expect(isIncompleteAssistantOutput("generation_exceeded_safety_limit", true)).toBe(true);
  });

  it("still discards a cancellation or degenerate-output interruption even when partial output exists", () => {
    expect(shouldDiscardPartialAssistantOutput("cancelled", undefined, true)).toBe(true);
    expect(shouldDiscardPartialAssistantOutput("degenerate_output", undefined, true)).toBe(true);
  });

  it("does not leave failed generation output as a completed reply", () => {
    expect(shouldDiscardPartialAssistantOutput(null, "unknown")).toBe(true);
    expect(generationNoticeKey(null, "unknown")).toBe("storageNotice.generationFailed");
  });
});

import { describe, expect, it } from "vitest";
import {
  generationNoticeKey,
  incompleteReasonFor,
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

  it("persists length-limited output even though it is not a natural completion", () => {
    expect(shouldPersistAssistantOutput("length", "partial reasoning")).toBe(true);
    expect(shouldPersistAssistantOutput("length", "")).toBe(false);
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
    expect(isIncompleteAssistantOutput(null, "generation_stalled", true)).toBe(true);
    expect(isIncompleteAssistantOutput(null, "generation_exceeded_safety_limit", true)).toBe(true);
  });

  it("preserves partial output from a length-limited generation, with its own distinct notice", () => {
    expect(shouldDiscardPartialAssistantOutput("length", undefined, true)).toBe(false);
    expect(shouldDiscardPartialAssistantOutput("length", undefined, false)).toBe(true);
    expect(generationNoticeKey("length")).toBe("storageNotice.generationLengthLimited");
    expect(isIncompleteAssistantOutput("length", undefined, true)).toBe(true);
    expect(isIncompleteAssistantOutput("length", undefined, false)).toBe(false);
  });

  it("a length-limited stop reason is never confused with a genuine stall/safety-limit notice", () => {
    expect(generationNoticeKey("length")).not.toBe("storageNotice.generationTimedOut");
    expect(generationNoticeKey("length")).not.toBe("storageNotice.generationSafetyLimit");
  });

  it("still discards a cancellation or degenerate-output interruption even when partial output exists", () => {
    expect(shouldDiscardPartialAssistantOutput("cancelled", undefined, true)).toBe(true);
    expect(shouldDiscardPartialAssistantOutput("degenerate_output", undefined, true)).toBe(true);
  });

  it("does not leave failed generation output as a completed reply", () => {
    expect(shouldDiscardPartialAssistantOutput(null, "unknown")).toBe(true);
    expect(generationNoticeKey(null, "unknown")).toBe("storageNotice.generationFailed");
  });

  it("shows no warning notice at all for a natural, complete stop", () => {
    expect(generationNoticeKey("completed")).toBeNull();
    expect(generationNoticeKey("completed", undefined, true)).toBeNull();
    expect(isIncompleteAssistantOutput("completed", undefined, true)).toBe(false);
  });

  it("preserves partial output from an unsupported tool-call termination, with a feature-not-supported notice, never scored as instability", () => {
    expect(shouldDiscardPartialAssistantOutput("unsupported_tool_call", undefined, true)).toBe(false);
    expect(shouldDiscardPartialAssistantOutput("unsupported_tool_call", undefined, false)).toBe(true);
    expect(generationNoticeKey("unsupported_tool_call")).toBe("storageNotice.generationUnsupportedFeature");
    expect(isIncompleteAssistantOutput("unsupported_tool_call", undefined, true)).toBe(true);
  });

  it("preserves partial output from a stream that ended with no finish_reason, failing closed rather than assuming success", () => {
    expect(shouldDiscardPartialAssistantOutput("unknown_terminal", undefined, true)).toBe(false);
    expect(shouldDiscardPartialAssistantOutput("unknown_terminal", undefined, false)).toBe(true);
    expect(generationNoticeKey("unknown_terminal", undefined, true)).toBe("storageNotice.generationUnknownIncomplete");
    expect(isIncompleteAssistantOutput("unknown_terminal", undefined, true)).toBe(true);
  });

  it("stays quiet for an unknown-terminal stream that produced no output and raised no runtime error, matching a silent empty-bubble discard", () => {
    expect(generationNoticeKey("unknown_terminal", undefined, false)).toBeNull();
  });

  describe("incompleteReasonFor", () => {
    it("maps each ambiguous terminal stop reason to its own persisted incomplete reason", () => {
      expect(incompleteReasonFor("length")).toBe("length");
      expect(incompleteReasonFor("unsupported_tool_call")).toBe("unsupported_tool_call");
      expect(incompleteReasonFor("unknown_terminal")).toBe("unknown_terminal");
    });

    it("maps watchdog-forced error codes to their own persisted incomplete reason", () => {
      expect(incompleteReasonFor(null, "generation_stalled")).toBe("stalled");
      expect(incompleteReasonFor(null, "generation_exceeded_safety_limit")).toBe("safety_limit");
    });

    it("is undefined for a natural completion or a discarded/cancelled generation", () => {
      expect(incompleteReasonFor("completed")).toBeUndefined();
      expect(incompleteReasonFor("cancelled")).toBeUndefined();
      expect(incompleteReasonFor("degenerate_output")).toBeUndefined();
    });
  });
});
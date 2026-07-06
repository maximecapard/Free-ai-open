import { describe, expect, it } from "vitest";
import {
  generationNoticeKey,
  shouldDiscardPartialAssistantOutput,
  shouldPersistAssistantOutput,
} from "./generationPersistence";

describe("generation persistence decisions", () => {
  it("persists only completed assistant output", () => {
    expect(shouldPersistAssistantOutput("completed", "normal reply")).toBe(true);
    expect(shouldPersistAssistantOutput("completed", "")).toBe(false);
  });

  it("does not save cancelled assistant output as a completed reply", () => {
    expect(shouldDiscardPartialAssistantOutput("cancelled")).toBe(true);
    expect(generationNoticeKey("cancelled")).toBe("storageNotice.generationStopped");
  });

  it("does not save degenerate assistant output as a completed reply", () => {
    expect(shouldDiscardPartialAssistantOutput("degenerate_output")).toBe(true);
    expect(generationNoticeKey("degenerate_output")).toBe("storageNotice.generationUnstable");
  });

  it("does not save stalled or timed-out generation output as a completed reply", () => {
    expect(shouldDiscardPartialAssistantOutput(null, "generation_stalled")).toBe(true);
    expect(shouldDiscardPartialAssistantOutput(null, "generation_timeout")).toBe(true);
    expect(generationNoticeKey(null, "generation_stalled")).toBe("storageNotice.generationTimedOut");
    expect(generationNoticeKey(null, "generation_timeout")).toBe("storageNotice.generationTimedOut");
  });

  it("does not leave failed generation output as a completed reply", () => {
    expect(shouldDiscardPartialAssistantOutput(null, "unknown")).toBe(true);
    expect(generationNoticeKey(null, "unknown")).toBe("storageNotice.generationFailed");
  });
});

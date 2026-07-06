import { describe, expect, it } from "vitest";
import { detectDegenerateOutput, GENERATION_SAFETY_LIMITS } from "./generation-safety";

describe("detectDegenerateOutput", () => {
  it("allows ordinary short output", () => {
    expect(detectDegenerateOutput("A short answer with normal punctuation.")).toEqual({ detected: false });
  });

  it("detects extremely long unbroken sequences", () => {
    const output = `prefix ${"x".repeat(GENERATION_SAFETY_LIMITS.maxUnbrokenSequenceCharacters + 1)}`;

    expect(detectDegenerateOutput(output)).toEqual({ detected: true, reason: "unbroken_sequence" });
  });

  it("detects repeated identical characters", () => {
    const output = "A" + "!".repeat(GENERATION_SAFETY_LIMITS.maxRepeatedCharacterRun + 1);

    expect(detectDegenerateOutput(output)).toEqual({ detected: true, reason: "repeated_character" });
  });

  it("detects repeated punctuation and symbol blocks", () => {
    const output = "<>".repeat(GENERATION_SAFETY_LIMITS.maxRepeatedSymbolBlockRun + 1);

    expect(detectDegenerateOutput(output)).toEqual({ detected: true, reason: "repeated_symbol_block" });
  });

  it("detects output beyond the character limit", () => {
    const output = `${"word ".repeat(3000)}x`;

    expect(detectDegenerateOutput(output)).toEqual({ detected: true, reason: "output_too_long" });
  });
});

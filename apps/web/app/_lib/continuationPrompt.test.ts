import { describe, expect, it } from "vitest";
import { buildContinuationPrompt } from "./continuationPrompt";

describe("buildContinuationPrompt", () => {
  it("includes both the original request and the partial content already produced", () => {
    const prompt = buildContinuationPrompt("Explique BeautifulSoup", "<think>Okay, the user", "en");
    expect(prompt).toContain("Explique BeautifulSoup");
    expect(prompt).toContain("<think>Okay, the user");
  });

  it("instructs the model not to repeat or restart, in English by default", () => {
    const prompt = buildContinuationPrompt("Explain X", "partial answer", "en");
    expect(prompt.toLowerCase()).toContain("do not repeat");
    expect(prompt.toLowerCase()).toContain("do not restart");
  });

  it("instructs the model not to repeat or restart, in French when the locale is fr", () => {
    const prompt = buildContinuationPrompt("Explique X", "reponse partielle", "fr");
    expect(prompt).toContain("Ne repete pas");
    expect(prompt).toContain("ne redemarre pas");
  });
});

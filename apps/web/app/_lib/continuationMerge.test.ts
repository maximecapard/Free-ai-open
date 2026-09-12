import { describe, expect, it } from "vitest";
import { mergeContinuationOverlap } from "./continuationMerge";

describe("mergeContinuationOverlap", () => {
  it("simply concatenates when there is no overlap at all", () => {
    expect(mergeContinuationOverlap("Hello", " world")).toBe("Hello world");
  });

  it("acts as a plain append for a fresh (non-continuation) generation, since priorContent is empty", () => {
    expect(mergeContinuationOverlap("", "Fresh answer.")).toBe("Fresh answer.");
  });

  it("removes a one-line exact overlap at the join point", () => {
    const prior = "def parse(html):\n    soup = BeautifulSoup(html, 'html.parser')";
    const continuation = "soup = BeautifulSoup(html, 'html.parser')\n    return soup.title";
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "def parse(html):\n    soup = BeautifulSoup(html, 'html.parser')\n    return soup.title"
    );
  });

  it("removes a multi-line exact overlap at the join point", () => {
    const prior = "Step 1: import bs4\nStep 2: fetch the page\nStep 3: parse it";
    const continuation = "Step 2: fetch the page\nStep 3: parse it\nStep 4: extract links";
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "Step 1: import bs4\nStep 2: fetch the page\nStep 3: parse it\nStep 4: extract links"
    );
  });

  it("matches the exact worked example from the mission: BeautifulSoup(html, 'html.parser') overlap", () => {
    const prior = "...BeautifulSoup(html, 'html.parser')";
    const continuation = "BeautifulSoup(html, 'html.parser')\nfor link in soup.find_all('a'):";
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "...BeautifulSoup(html, 'html.parser')\nfor link in soup.find_all('a'):"
    );
  });

  it("never removes repeated code that appears again later, only a substantial overlap exactly at the join point", () => {
    const prior = "x = 1\nprint(x)\nsome_shared_result = compute(x)";
    const continuation = "some_shared_result = compute(x)\nprint(x)\nz = 3";
    // Only the (26-character, well above the minimum) "some_shared_result =
    // compute(x)" join-point overlap is trimmed; the later, coincidentally
    // identical "print(x)" line inside the continuation is real new content
    // and must be kept in full.
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "x = 1\nprint(x)\nsome_shared_result = compute(x)\nprint(x)\nz = 3"
    );
  });

  it("does not trim a trivial one- or two-character coincidental match", () => {
    expect(mergeContinuationOverlap("Hello.", ". More text.")).toBe("Hello.. More text.");
  });

  it("item 5 (mandatory): a short shared word like 'the' at the join point is kept, not deleted -- it is far more likely to be legitimate text than a duplicated-continuation artifact", () => {
    const prior = "I was reading about the";
    const continuation = "the history of the Roman Empire.";
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "I was reading about thethe history of the Roman Empire."
    );
  });

  it("item 5 (mandatory): a short shared code token like '});' at the join point is kept, not deleted", () => {
    const prior = "function done() {\n  callback();\n});";
    const continuation = "});\nmodule.exports = done;";
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "function done() {\n  callback();\n});});\nmodule.exports = done;"
    );
  });

  it("keeps an overlap of exactly one character below the minimum threshold (23 characters) unmerged", () => {
    const overlap = "x".repeat(23);
    const prior = `prefix-${overlap}`;
    const continuation = `${overlap}-suffix`;
    expect(mergeContinuationOverlap(prior, continuation)).toBe(`prefix-${overlap}${overlap}-suffix`);
  });

  it("merges an overlap of exactly the minimum threshold (24 characters)", () => {
    const overlap = "x".repeat(24);
    const prior = `prefix-${overlap}`;
    const continuation = `${overlap}-suffix`;
    expect(mergeContinuationOverlap(prior, continuation)).toBe(`prefix-${overlap}-suffix`);
  });

  it("handles an empty continuation without crashing, returning priorContent unchanged", () => {
    expect(mergeContinuationOverlap("Some prior content.", "")).toBe("Some prior content.");
  });

  it("does not crash on Unicode content, and correctly keeps a short (below-threshold) accented overlap unmerged rather than risking a miscount", () => {
    const prior = "Réponse partielle : voici le code";
    const continuation = "le code à exécuter maintenant.";
    // "le code" is only 7 characters -- well below the 24-character
    // minimum -- so per item 5 this must be kept, not silently trimmed,
    // even though it is an exact join-point match.
    expect(() => mergeContinuationOverlap(prior, continuation)).not.toThrow();
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "Réponse partielle : voici le codele code à exécuter maintenant."
    );
  });

  it("deduplicates a genuinely substantial accented/Unicode overlap at the join point", () => {
    const prior = "Réponse partielle : voici la réponse complète à ta question précédente";
    const continuation = "la réponse complète à ta question précédente, avec tous les détails.";
    // The shared clause is well over the 24-character minimum, counted in
    // UTF-16 code units the same way accented Latin characters are (each
    // one is a single code unit, unlike astral-plane emoji).
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "Réponse partielle : voici la réponse complète à ta question précédente, avec tous les détails."
    );
  });

  it("does not crash on emoji/astral-plane characters when there is no overlap", () => {
    expect(() => mergeContinuationOverlap("Great work! 🎉", " Let's continue.")).not.toThrow();
    expect(mergeContinuationOverlap("Great work! 🎉", " Let's continue.")).toBe("Great work! 🎉 Let's continue.");
  });

  it("safely deduplicates a substantial overlap that contains an emoji (a 2-code-unit surrogate pair) without corrupting it", () => {
    const sharedTail = "Great work so far 🎉🚀 on this project";
    const prior = `Intro text. ${sharedTail}`;
    const continuation = `${sharedTail}, let's keep going.`;
    expect(mergeContinuationOverlap(prior, continuation)).toBe(`Intro text. ${sharedTail}, let's keep going.`);
  });

  it("removes an overlap that spans a Markdown code fence boundary", () => {
    const prior = "Here is the function:\n```python\ndef parse(html):\n    return html";
    const continuation = "```python\ndef parse(html):\n    return html\n```\nThat's the whole function.";
    expect(mergeContinuationOverlap(prior, continuation)).toBe(
      "Here is the function:\n```python\ndef parse(html):\n    return html\n```\nThat's the whole function."
    );
  });

  it("converges to the same final result whether applied once on the full delta or incrementally chunk-by-chunk (proves correctness independent of React render/flush timing)", () => {
    // Mirrors exactly what AppRuntimeProvider.tsx's generation accumulator
    // does: recompute mergedContent = mergeContinuationOverlap(priorContent,
    // generatedDelta) after EVERY raw chunk, regardless of how or when a
    // buffered UI flush happens to read it. This proves the accumulator's
    // final value never depends on how many discrete chunks arrived or how
    // React's own state updates happened to be scheduled/delayed/batched --
    // it is a pure function of priorContent and the full accumulated delta.
    const prior = "def parse(html):\n    soup = BeautifulSoup(html, 'html.parser')";
    const chunks = ["soup", " = BeautifulSoup(html", ", 'html.parser')", "\n    return soup", ".title"];

    let delta = "";
    let incrementalResult = prior;
    for (const chunk of chunks) {
      delta += chunk;
      incrementalResult = mergeContinuationOverlap(prior, delta);
    }

    const oneShotResult = mergeContinuationOverlap(prior, chunks.join(""));
    expect(incrementalResult).toBe(oneShotResult);
    expect(incrementalResult).toBe(
      "def parse(html):\n    soup = BeautifulSoup(html, 'html.parser')\n    return soup.title"
    );
  });

  it("only searches within the bounded overlap window, never scanning the entire prior content", () => {
    const uniqueTail = "UNIQUE_TAIL_MARKER_VALUE"; // 24 characters -- exactly the minimum
    const prior = `${"a".repeat(1000)}${uniqueTail}`;
    const continuation = `${uniqueTail} and more.`;
    // uniqueTail is well within the default window, so the overlap is still
    // found and trimmed even though priorContent is long.
    expect(mergeContinuationOverlap(prior, continuation)).toBe(`${"a".repeat(1000)}${uniqueTail} and more.`);
  });
});

import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_OVERHEAD_TOKENS,
  CONTEXT_SAFETY_MARGIN_TOKENS,
  MINIMUM_USEFUL_OUTPUT_TOKENS,
  calculateGenerationBudget,
  estimateChatInputTokens,
  estimateTokenCount,
} from "./contextBudget";

describe("estimateTokenCount", () => {
  it("is zero for an empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("counts plain ASCII as one byte per character", () => {
    expect(estimateTokenCount("abcdef")).toBe(6);
    expect(estimateTokenCount("abcdefghi")).toBe(9);
  });

  it("never returns fewer estimated tokens than a naive one-token-per-character count -- the loosest a real BPE tokenizer could ever get", () => {
    const samples = [
      "Plain English sentence with punctuation, dashes -- and (parentheses).",
      "Voici un texte en français avec des accents : café, à Noël, çà et là, où l'été.",
      "日本語のテキストです。中文文本也在这里。한국어 텍스트도 있습니다.",
      "Emoji stress test: 🎉🚀🔥💯😀🧠🛠️ done.",
      "def parse(x):\n    return {'a': [1, 2, 3], 'b': x.strip()}\n",
      "```js\nfunction add(a, b) {\n  return a + b;\n}\n```",
      "<div class=\"card\">\n  <p>Hello &amp; welcome</p>\n</div>",
      "!!!???...,,,;;;:::---___===+++",
    ];

    for (const sample of samples) {
      expect(estimateTokenCount(sample)).toBeGreaterThanOrEqual(sample.length);
    }
  });

  it("charges strictly more for dense multi-byte Unicode than the old (removed) characters-per-token heuristic ever did -- the exact under-estimation this replaces", () => {
    // A single Chinese/Japanese/Korean character is 3 UTF-8 bytes; the old
    // `Math.ceil(charLength / 3)` estimator would have reported roughly
    // ONE estimated token for every 3 CJK characters, when real tokenizers
    // routinely need close to one token PER character (or more) for CJK
    // text with uneven vocabulary coverage.
    const cjk = "你好世界你好世界你好世界"; // 12 characters, 36 UTF-8 bytes
    const oldEstimate = Math.ceil(cjk.length / 3); // 4 -- the old formula's answer
    expect(estimateTokenCount(cjk)).toBe(36);
    expect(estimateTokenCount(cjk)).toBeGreaterThan(oldEstimate * 5); // 36 > 20: nearly a 9x difference
  });

  it("counts a single emoji as its full multi-byte UTF-8 width, not as one or two JS string units", () => {
    // U+1F389 PARTY POPPER is a surrogate pair in JS (.length === 2) but
    // encodes to 4 bytes in UTF-8 -- the estimate must reflect the wire
    // encoding, not the JS string's internal UTF-16 unit count.
    const emoji = "\u{1F389}";
    expect(emoji.length).toBe(2);
    expect(estimateTokenCount(emoji)).toBe(4);
  });

  it("counts an accented Latin character as its 2-byte UTF-8 width", () => {
    expect(estimateTokenCount("e")).toBe(1);
    expect(estimateTokenCount("é")).toBe(2); // "é"
  });

  it("scales with a long adversarial French/accented paragraph without under-counting relative to raw byte size", () => {
    const paragraph =
      "L'élève réussira à l'école grâce à énormément de persévérance, même lorsque " +
      "les résultats sont décevants, à condition qu'il révise régulièrement et " +
      "qu'il n'hésite jamais à poser des questions précises à ses professeurs.";
    const expectedBytes = new TextEncoder().encode(paragraph).length;
    expect(estimateTokenCount(paragraph)).toBe(expectedBytes);
    expect(estimateTokenCount(paragraph)).toBeGreaterThan(paragraph.length);
  });
});

describe("estimateChatInputTokens", () => {
  it("is zero for no segments or only empty segments", () => {
    expect(estimateChatInputTokens([])).toBe(0);
    expect(estimateChatInputTokens(["", ""])).toBe(0);
  });

  it("charges CHAT_MESSAGE_OVERHEAD_TOKENS once per non-empty segment, on top of its byte length", () => {
    const systemInstruction = "Respond in English.";
    const userPrompt = "Explain recursion.";

    const expected =
      estimateTokenCount(systemInstruction) +
      CHAT_MESSAGE_OVERHEAD_TOKENS +
      estimateTokenCount(userPrompt) +
      CHAT_MESSAGE_OVERHEAD_TOKENS;

    expect(estimateChatInputTokens([systemInstruction, userPrompt])).toBe(expected);
  });

  it("does not charge overhead for an empty segment mixed in with real ones", () => {
    const withEmpty = estimateChatInputTokens(["Respond in English.", "", "Explain recursion."]);
    const withoutEmpty = estimateChatInputTokens(["Respond in English.", "Explain recursion."]);
    expect(withEmpty).toBe(withoutEmpty);
  });

  it("accounts for a long Continue request that re-embeds an entire prior reply as one of its segments", () => {
    const systemInstruction = "Respond in English.";
    const priorReply =
      "Here is a very long prior assistant reply that must be re-embedded in full so the model has the " +
      "context to continue naturally from exactly where it left off, including several sentences of " +
      "technical explanation, a couple of code identifiers like `contextBudget.ts`, and punctuation-heavy " +
      "asides (e.g. this one) that a real conversation would plausibly contain.";
    const continuationInstruction = "Continue your previous answer from exactly where it stopped.";

    const total = estimateChatInputTokens([systemInstruction, priorReply, continuationInstruction]);
    const expected =
      estimateTokenCount(systemInstruction) +
      estimateTokenCount(priorReply) +
      estimateTokenCount(continuationInstruction) +
      3 * CHAT_MESSAGE_OVERHEAD_TOKENS;

    expect(total).toBe(expected);
    // Materially larger than just the continuation instruction alone --
    // the whole point of budgeting Continue separately (see
    // contextBudget.test.ts's "Continue re-embedding a long prior reply"
    // case below).
    expect(total).toBeGreaterThan(estimateTokenCount(continuationInstruction) * 5);
  });
});

describe("calculateGenerationBudget", () => {
  const base = {
    minimumOutputTokens: MINIMUM_USEFUL_OUTPUT_TOKENS,
    safetyMargin: CONTEXT_SAFETY_MARGIN_TOKENS,
  };

  it("grants the full desired output budget when the context window has ample room (4096 context, short prompt)", () => {
    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 4096,
      estimatedInputTokens: 50,
      desiredOutputTokens: 1024,
    });

    expect(result.allowedOutputTokens).toBe(1024);
    expect(result.warning).toBeUndefined();
    expect(result.confidence).toBe("conservative");
  });

  it("tightens the output budget on a small 1024-token context window with a real input (the Qwen3 Fast case)", () => {
    // Mirrors the real reported case: Qwen3 in "fast" mode loads a 1024-
    // token context but the pre-fix code requested up to 768 output tokens
    // regardless of input size.
    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 1024,
      estimatedInputTokens: 500,
      desiredOutputTokens: 768,
    });

    expect(result.allowedOutputTokens).toBeLessThan(768);
    expect(result.allowedOutputTokens).toBe(1024 - 500 - CONTEXT_SAFETY_MARGIN_TOKENS);
  });

  it("never requests more than the desired output even with abundant remaining context (2048 context, the Qwen3 Balanced case)", () => {
    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 2048,
      estimatedInputTokens: 10,
      desiredOutputTokens: 512,
    });

    expect(result.allowedOutputTokens).toBe(512);
  });

  it("scales down cleanly for a very short prompt vs. a long prompt on the same context window", () => {
    const shortPrompt = calculateGenerationBudget({
      ...base,
      contextWindow: 2048,
      estimatedInputTokens: 20,
      desiredOutputTokens: 512,
    });
    const longPrompt = calculateGenerationBudget({
      ...base,
      contextWindow: 2048,
      estimatedInputTokens: 1900,
      desiredOutputTokens: 512,
    });

    expect(shortPrompt.allowedOutputTokens).toBe(512);
    expect(longPrompt.allowedOutputTokens).toBeLessThan(shortPrompt.allowedOutputTokens);
  });

  it("accounts for a reasoning model's larger desired output budget (4096 context, the Qwen3 Performance case)", () => {
    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 4096,
      estimatedInputTokens: 200,
      // 1024 preset + 512 reasoning allowance, as adaptiveOutputBudget.ts
      // would produce for a Qwen3 candidate.
      desiredOutputTokens: 1536,
    });

    expect(result.allowedOutputTokens).toBe(1536);
  });

  it("accounts for Continue re-embedding a long prior reply as input", () => {
    // A long prior reply (e.g. ~600 estimated tokens) plus the continuation
    // instruction leaves much less room than a fresh short prompt would.
    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 1024,
      estimatedInputTokens: 600,
      desiredOutputTokens: 768,
    });

    expect(result.allowedOutputTokens).toBe(1024 - 600 - CONTEXT_SAFETY_MARGIN_TOKENS);
    expect(result.allowedOutputTokens).toBeLessThan(768);
  });

  it("warns and reports zero/insufficient budget when there is no useful room left", () => {
    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 1024,
      estimatedInputTokens: 1000,
      desiredOutputTokens: 768,
    });

    expect(result.warning).toBe("insufficient_context_for_minimum_output");
    expect(result.allowedOutputTokens).toBeLessThan(base.minimumOutputTokens);
  });

  it("never returns a negative allowed or remaining budget when input already exceeds the context window", () => {
    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 1024,
      estimatedInputTokens: 5000,
      desiredOutputTokens: 768,
    });

    expect(result.allowedOutputTokens).toBe(0);
    expect(result.remainingContextTokens).toBe(0);
    expect(result.warning).toBe("insufficient_context_for_minimum_output");
  });

  it("still respects a global safety ceiling passed in as the desired output -- the ceiling is a maximum, not the context-safety mechanism", () => {
    // Even with a huge context window, calculateGenerationBudget never
    // grants more than desiredOutputTokens, which is where a caller applies
    // the separate global 2048-token safety cap before calling this.
    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 100_000,
      estimatedInputTokens: 10,
      desiredOutputTokens: 2048,
    });

    expect(result.allowedOutputTokens).toBe(2048);
  });

  it("end-to-end: a real adversarial CJK+emoji+code prompt on a small context window still leaves a safe, non-negative budget", () => {
    const systemInstruction = "Respond in English.";
    const prompt =
      "日本語で書かれたコードのバグを直してください 🐛🔧\n```python\ndef f(x):\n    return x*x\n```";
    const estimatedInputTokens = estimateChatInputTokens([systemInstruction, prompt]);

    const result = calculateGenerationBudget({
      ...base,
      contextWindow: 1024,
      estimatedInputTokens,
      desiredOutputTokens: 256,
    });

    expect(result.allowedOutputTokens).toBeGreaterThanOrEqual(0);
    expect(result.allowedOutputTokens).toBeLessThanOrEqual(256);
    expect(estimatedInputTokens + result.allowedOutputTokens + CONTEXT_SAFETY_MARGIN_TOKENS).toBeLessThanOrEqual(1024);
  });
});

import { describe, expect, it } from "vitest";
import { isReasoningInterrupted, isValidClosingFenceLine, segmentReasoning } from "./reasoningSegmentation";

describe("segmentReasoning", () => {
  it("treats content with no <think> tag as plain final-answer text", () => {
    const result = segmentReasoning("Bonjour ! Comment puis-je vous aider ?");
    expect(result).toEqual({
      beforeReasoning: "Bonjour ! Comment puis-je vous aider ?",
      reasoning: null,
      reasoningOpen: false,
      afterReasoning: "",
    });
  });

  it("splits a complete <think>...</think> block from the final answer", () => {
    const result = segmentReasoning("<think>\nOkay, the user said hi.\n</think>\n\nBonjour !");
    expect(result.beforeReasoning).toBe("");
    expect(result.reasoning).toBe("\nOkay, the user said hi.\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\n\nBonjour !");
  });

  it("treats an unclosed <think> block as still-open reasoning with no final answer yet", () => {
    const result = segmentReasoning("<think>\nOkay, the user is asking about BeautifulSoup");
    expect(result.reasoning).toBe("\nOkay, the user is asking about BeautifulSoup");
    expect(result.reasoningOpen).toBe(true);
    expect(result.afterReasoning).toBe("");
  });

  it("does not crash on malformed or stray closing tags with no opening tag", () => {
    expect(() => segmentReasoning("Hello </think> world")).not.toThrow();
    const result = segmentReasoning("Hello </think> world");
    expect(result.reasoning).toBeNull();
    expect(result.beforeReasoning).toBe("Hello </think> world");
  });

  it("does not crash on an empty string", () => {
    expect(() => segmentReasoning("")).not.toThrow();
    expect(segmentReasoning("").reasoning).toBeNull();
  });

  it("does not crash on an all-whitespace string", () => {
    expect(() => segmentReasoning("   \n\t  ")).not.toThrow();
    expect(segmentReasoning("   \n\t  ").reasoning).toBeNull();
  });

  it("does not crash on multiple <think> tags, treating only the first (leading) pair as the reasoning block", () => {
    expect(() => segmentReasoning("<think>a</think>middle<think>b</think>end")).not.toThrow();
    const result = segmentReasoning("<think>a</think>middle<think>b</think>end");
    expect(result.reasoning).toBe("a");
    expect(result.afterReasoning).toBe("middle<think>b</think>end");
  });
});

describe("segmentReasoning -- item 6: <think> is only reasoning when it is the leading content", () => {
  it("ignores optional leading whitespace/newlines before a real leading <think> tag", () => {
    const result = segmentReasoning("\n\n  <think>\nreasoning\n</think>\nFinal answer.");
    expect(result.beforeReasoning).toBe("\n\n  ");
    expect(result.reasoning).toBe("\nreasoning\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer.");
  });

  it("recognizes a leading <think> with no whitespace before it at all (the common Qwen3 case)", () => {
    const result = segmentReasoning("<think>reasoning</think>Answer.");
    expect(result.beforeReasoning).toBe("");
    expect(result.reasoning).toBe("reasoning");
    expect(result.afterReasoning).toBe("Answer.");
  });

  it("recognizes an unclosed leading <think> preceded only by leading whitespace as still-open reasoning", () => {
    const result = segmentReasoning("\n<think>still going");
    expect(result.beforeReasoning).toBe("\n");
    expect(result.reasoning).toBe("still going");
    expect(result.reasoningOpen).toBe(true);
  });

  it("mandatory: real visible text before <think> means the ENTIRE message is literal final-answer text, never reasoning", () => {
    // Per item 6, any non-whitespace content before <think> disqualifies it
    // as a reasoning-opening marker -- a real Qwen3 template never writes
    // visible text before its own <think> block, so text like this can only
    // be the model discussing the tag itself, not opening real reasoning.
    const content = "Sure.<think>reasoning</think>Answer.";
    const result = segmentReasoning(content);
    expect(result).toEqual({ beforeReasoning: content, reasoning: null, reasoningOpen: false, afterReasoning: "" });
  });

  it("mandatory: a raw HTML example containing <think> later in normal prose remains fully literal", () => {
    // The exact motivating scenario: the assistant is explaining/showing
    // HTML that happens to contain the literal string "<think>", not
    // opening a real reasoning block.
    const content = "Here is an example: <div> <think>visible HTML example</think> </div> -- note the nesting.";
    const result = segmentReasoning(content);
    expect(result).toEqual({ beforeReasoning: content, reasoning: null, reasoningOpen: false, afterReasoning: "" });
  });

  it("mandatory: a literal raw-HTML example appearing later in the response (after real leading reasoning) is never re-interpreted as reasoning", () => {
    const content =
      "<think>\nLet me answer directly.\n</think>\nHere is an example: <div><think>visible</think></div> in HTML.";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\nLet me answer directly.\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nHere is an example: <div><think>visible</think></div> in HTML.");
  });

  it("mandatory: a nested LATER <think> inside the reasoning block is never treated as opening additional hidden reasoning", () => {
    const content = "<think>reasoning here <think>nested</think> more reasoning</think>Final answer.";
    const result = segmentReasoning(content);
    // The FIRST </think> after the leading <think> ends the ONE reasoning
    // segment -- the nested opening tag is just literal text inside it, and
    // everything from the first close onward (including the orphaned
    // "</think>" that follows) is plain final-answer text, never re-parsed.
    expect(result.reasoning).toBe("reasoning here <think>nested");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe(" more reasoning</think>Final answer.");
  });

  it("mandatory: malformed tags (wrong case) never open reasoning even at the leading position", () => {
    const content = "<Think>not a real tag</Think>Answer.";
    const result = segmentReasoning(content);
    expect(result).toEqual({ beforeReasoning: content, reasoning: null, reasoningOpen: false, afterReasoning: "" });
  });

  it("mandatory: malformed tags (unexpected internal space) never open reasoning even at the leading position", () => {
    const content = "<think >not a real tag</think>Answer.";
    const result = segmentReasoning(content);
    expect(result).toEqual({ beforeReasoning: content, reasoning: null, reasoningOpen: false, afterReasoning: "" });
  });

  it("mandatory: an unclosed malformed tag at the leading position does not crash and is treated as literal", () => {
    expect(() => segmentReasoning("<thi")).not.toThrow();
    expect(segmentReasoning("<thi").reasoning).toBeNull();
  });
});

describe("segmentReasoning Markdown-awareness", () => {
  it("does not treat a literal <think> tag inside a fenced code block as real reasoning markup", () => {
    const content = "```html\n<think>\ninside a fenced code block must remain code.\n```\nOutside.";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBeNull();
    expect(result.beforeReasoning).toBe(content);
  });

  it("still detects a real <think> tag that appears before a code block", () => {
    const content = "<think>\nLet me write:\n```python\nx = 1\n```\nThen answer.\n</think>\n\nFinal answer.";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\nLet me write:\n```python\nx = 1\n```\nThen answer.\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\n\nFinal answer.");
  });

  it("keeps a code block that appears inside real reasoning as part of the reasoning text, not the final answer", () => {
    const content = "<think>\n```js\nconst x = 1;\n```\n</think>\nDone.";
    const result = segmentReasoning(content);
    expect(result.reasoning).toContain("const x = 1;");
    expect(result.afterReasoning).toBe("\nDone.");
  });

  it("does not treat a literal <think> inside an inline code span as real reasoning markup", () => {
    const content = "The model wraps reasoning in `<think>` tags before answering.";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBeNull();
    expect(result.beforeReasoning).toBe(content);
  });

  it("does not crash on an unclosed fence and treats everything after it as code, including any literal think markup", () => {
    const content = "```python\n<think>\nprint('still streaming'";
    expect(() => segmentReasoning(content)).not.toThrow();
    const result = segmentReasoning(content);
    expect(result.reasoning).toBeNull();
  });

  it("does not crash on a malformed/mismatched think tag inside code", () => {
    expect(() => segmentReasoning("```\n<Think>not a real tag, wrong case\n```")).not.toThrow();
    expect(() => segmentReasoning("`</think>` stray closing tag inside code")).not.toThrow();
  });

  it("renders the real historical BeautifulSoup regression message correctly with no code fences involved at all", () => {
    // The real bug report's content has no Markdown code fences in the
    // reasoning itself -- this is the primary backward-compatibility case
    // Markdown-awareness must never regress.
    const content =
      "<think>\nOkay, the user is asking for an example of a parser algorithm using BeautifulSoup. Let me start by recalling what BeautifulSoup is.";
    const result = segmentReasoning(content);
    expect(result.reasoningOpen).toBe(true);
    expect(result.reasoning).toContain("BeautifulSoup");
  });

  it("item 7 (mandatory): does not treat a literal </think> inside a TILDE-fenced code block (within real leading reasoning) as the real close tag", () => {
    const content =
      "<think>\nHere's an example of the tag:\n~~~html\n<div></think></div>\n~~~\nOkay, now the real answer.\n</think>\nFinal answer.";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe(
      "\nHere's an example of the tag:\n~~~html\n<div></think></div>\n~~~\nOkay, now the real answer.\n"
    );
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer.");
  });

  it("item 7 (mandatory): does not treat a literal <think> tag inside a TILDE-fenced code block as real reasoning markup", () => {
    const content = "~~~html\n<think>\ninside a tilde-fenced code block must remain code.\n~~~\nOutside.";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBeNull();
    expect(result.beforeReasoning).toBe(content);
  });
});

describe("segmentReasoning -- blocker: an unterminated Markdown fence must never hide the real </think> terminator", () => {
  it("A. malformed TILDE fence: closes reasoning at the real </think>, keeping the malformed fence content as reasoning text", () => {
    const content = "<think>\nanalysis\n~~~html\n<div>\n</think>\nFinal answer";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\nanalysis\n~~~html\n<div>\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer");
  });

  it("B. malformed BACKTICK fence: closes reasoning at the real </think>, keeping the malformed fence content as reasoning text", () => {
    const content = "<think>\nanalysis\n```html\n<div>\n</think>\nFinal answer";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\nanalysis\n```html\n<div>\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer");
  });

  it("C. a PROPERLY CLOSED tilde fence containing a literal </think> still protects it; the real second </think> closes reasoning", () => {
    const content = "<think>\n~~~html\n</think>\n~~~\nstill reasoning\n</think>\nFinal answer";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\n~~~html\n</think>\n~~~\nstill reasoning\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer");
  });

  it("D. a PROPERLY CLOSED backtick fence containing a literal </think> still protects it; the real second </think> closes reasoning", () => {
    const content = "<think>\n```html\n</think>\n```\nstill reasoning\n</think>\nFinal answer";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\n```html\n</think>\n```\nstill reasoning\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer");
  });

  it("E. a literal </think> inside a matched inline-code span does not close reasoning; the real </think> does", () => {
    const content = "<think>\nThe literal tag is `</think>` here.\nStill reasoning.\n</think>\nFinal answer";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\nThe literal tag is `</think>` here.\nStill reasoning.\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer");
  });

  it("F. an unclosed (stray, unmatched) inline-code backtick must not swallow the real </think>/final answer either", () => {
    const content = "<think>\nHere's a lone backtick ` that never closes.\n</think>\nFinal answer";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\nHere's a lone backtick ` that never closes.\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer");
  });

  it("G. streaming: a malformed/unclosed fence arrives first, the real </think> arrives later, and the final answer streams in without duplication", () => {
    const stage1 = "<think>\nanalysis\n~~~html\n";
    const stage2 = `${stage1}<div>\n`;
    const stage3 = `${stage2}</think>\n`;
    const stage4 = `${stage3}Final `;
    const stage5 = `${stage4}answer`;

    const result1 = segmentReasoning(stage1);
    expect(result1.reasoningOpen).toBe(true);
    expect(result1.reasoning).toBe("\nanalysis\n~~~html\n");
    expect(result1.afterReasoning).toBe("");

    const result2 = segmentReasoning(stage2);
    expect(result2.reasoningOpen).toBe(true);
    expect(result2.reasoning).toBe("\nanalysis\n~~~html\n<div>\n");

    // The real </think> has now arrived even though the fence opened at
    // stage1 never closed -- this is the exact blocker: reasoning must
    // close here, not stay open forever because of the malformed fence.
    const result3 = segmentReasoning(stage3);
    expect(result3.reasoningOpen).toBe(false);
    expect(result3.reasoning).toBe("\nanalysis\n~~~html\n<div>\n");
    expect(result3.afterReasoning).toBe("\n");

    const result4 = segmentReasoning(stage4);
    expect(result4.afterReasoning).toBe("\nFinal ");

    const result5 = segmentReasoning(stage5);
    expect(result5.afterReasoning).toBe("\nFinal answer");
    // No duplication: the final afterReasoning is exactly the concatenation
    // of what streamed in after the close, nothing repeated or dropped.
    expect(result5.reasoning).toBe(result3.reasoning);
  });

  it("H. a fully-formed historical/persisted message with a malformed fence (not a live stream) still renders its final answer after reload", () => {
    // Mechanically identical to A/B -- segmentReasoning() is a single pure
    // function with no separate "streaming" vs. "reload" code path -- but
    // exercised here as a complete, already-finished string to make that
    // guarantee explicit for old exported/reloaded conversations.
    const content = "<think>\nOlder analysis\n```json\n{\"a\": 1\n</think>\nThe final answer from before this fix existed.";
    const result = segmentReasoning(content);
    expect(result.reasoningOpen).toBe(false);
    expect(result.reasoning).toBe('\nOlder analysis\n```json\n{"a": 1\n');
    expect(result.afterReasoning).toBe("\nThe final answer from before this fix existed.");
  });
});

describe("isValidClosingFenceLine -- pseudo closing fences must be rejected", () => {
  it("rejects a candidate line carrying trailing info-string-like text (tilde) -- this is the exact bug: only an OPENING fence may carry trailing content", () => {
    expect(isValidClosingFenceLine("~~~html", "~~~")).toBe(false);
    expect(isValidClosingFenceLine("~~~not-a-closing-fence", "~~~")).toBe(false);
    expect(isValidClosingFenceLine("~~~xyz", "~~~")).toBe(false);
  });

  it("rejects a candidate line carrying trailing info-string-like text (backtick)", () => {
    expect(isValidClosingFenceLine("```html", "```")).toBe(false);
    expect(isValidClosingFenceLine("```not-a-closing-fence", "```")).toBe(false);
    expect(isValidClosingFenceLine("```xyz", "```")).toBe(false);
  });

  it("rejects a candidate line with a space+word or punctuation suffix (tilde)", () => {
    expect(isValidClosingFenceLine("~~~ nope", "~~~")).toBe(false);
    expect(isValidClosingFenceLine("~~~#", "~~~")).toBe(false);
  });

  it("rejects a candidate line with a space+word or punctuation suffix (backtick)", () => {
    expect(isValidClosingFenceLine("``` nope", "```")).toBe(false);
    expect(isValidClosingFenceLine("```#", "```")).toBe(false);
  });

  it("accepts a suffix of spaces/tabs only, since CommonMark allows trailing whitespace on a closing fence line (tilde)", () => {
    expect(isValidClosingFenceLine("~~~   ", "~~~")).toBe(true);
    expect(isValidClosingFenceLine("~~~\t", "~~~")).toBe(true);
  });

  it("accepts a suffix of spaces/tabs only (backtick)", () => {
    expect(isValidClosingFenceLine("```   ", "```")).toBe(true);
    expect(isValidClosingFenceLine("```\t", "```")).toBe(true);
  });

  it("accepts a longer closing fence than the opening one (tilde: opened with ~~~, closed with ~~~~~)", () => {
    expect(isValidClosingFenceLine("~~~~~", "~~~")).toBe(true);
  });

  it("accepts a longer closing fence than the opening one (backtick: opened with ```, closed with `````)", () => {
    expect(isValidClosingFenceLine("`````", "```")).toBe(true);
  });

  it("rejects a shorter closing fence than the opening one (tilde: opened with ~~~~~, closed with ~~~)", () => {
    expect(isValidClosingFenceLine("~~~", "~~~~~")).toBe(false);
  });

  it("rejects a shorter closing fence than the opening one (backtick: opened with `````, closed with ```)", () => {
    expect(isValidClosingFenceLine("```", "`````")).toBe(false);
  });

  it("rejects a mismatched marker character in either direction -- tilde cannot close backtick and vice versa", () => {
    expect(isValidClosingFenceLine("```", "~~~")).toBe(false);
    expect(isValidClosingFenceLine("~~~", "```")).toBe(false);
  });

  it("accepts 0, 1, 2, or 3 leading spaces before an otherwise-valid closing fence", () => {
    expect(isValidClosingFenceLine("~~~", "~~~")).toBe(true);
    expect(isValidClosingFenceLine(" ~~~", "~~~")).toBe(true);
    expect(isValidClosingFenceLine("  ~~~", "~~~")).toBe(true);
    expect(isValidClosingFenceLine("   ~~~", "~~~")).toBe(true);
  });

  it("rejects 4 or more leading spaces even though everything else about the line is otherwise valid", () => {
    expect(isValidClosingFenceLine("    ~~~", "~~~")).toBe(false);
    expect(isValidClosingFenceLine("     ~~~", "~~~")).toBe(false);
  });

  it("handles a CRLF line ending safely -- a trailing carriage return is not suffix text", () => {
    expect(isValidClosingFenceLine("~~~\r", "~~~")).toBe(true);
    expect(isValidClosingFenceLine("~~~html\r", "~~~")).toBe(false);
  });
});

describe("segmentReasoning -- a pseudo closing fence (fence-marker-shaped line with trailing text) must never be accepted as a real close", () => {
  it("the exact Codex reproduction (tilde): a pseudo-closing fence AFTER the real </think> must never retroactively protect it -- reasoning closes and Final answer is preserved", () => {
    const content = "<think>\nanalysis\n~~~html\n<div>\n</think>\nFinal answer\n~~~not-a-closing-fence";
    const result = segmentReasoning(content);
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toContain("Final answer");
  });

  it("the exact Codex reproduction (backtick equivalent)", () => {
    const content = "<think>\nanalysis\n```html\n<div>\n</think>\nFinal answer\n```not-a-closing-fence";
    const result = segmentReasoning(content);
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toContain("Final answer");
  });

  it("critical structural reconfirmation: a genuinely CLOSED fence containing a literal </think> still protects it, and the real second </think> closes reasoning", () => {
    const content = "<think>\n~~~html\n</think>\n~~~\nstill reasoning\n</think>\nFinal answer";
    const result = segmentReasoning(content);
    expect(result.reasoning).toBe("\n~~~html\n</think>\n~~~\nstill reasoning\n");
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toBe("\nFinal answer");
  });

  it("a failed backtick pseudo-close is never mistaken for an inline-code delimiter and paired with an unrelated backtick run elsewhere in the message, and genuine inline code elsewhere still works", () => {
    // Without excluding fence-candidate lines from inline-code detection,
    // the two fence-marker-shaped backtick runs below ("```html" and
    // "```not-a-closing-fence") would themselves get paired by
    // findInlineCodeRanges() into a bogus multi-line "inline span"
    // spanning the real </think> -- the exact secondary bug found while
    // fixing the backtick version of the Codex reproduction.
    const content =
      "<think>\nanalysis\n```html\n<div>\n</think>\nFinal answer with `genuine inline code` in it.\n```not-a-closing-fence";
    const result = segmentReasoning(content);
    expect(result.reasoningOpen).toBe(false);
    expect(result.afterReasoning).toContain("Final answer");
    expect(result.afterReasoning).toContain("`genuine inline code`");
  });
});

describe("isReasoningInterrupted", () => {
  it("is false while the message is still the actively streaming generation, even with an open think block", () => {
    const segments = segmentReasoning("<think>still reasoning");
    expect(isReasoningInterrupted(segments, true)).toBe(false);
  });

  it("is true when a think block is open and the message is no longer actively generating", () => {
    const segments = segmentReasoning("<think>cut off mid-thought");
    expect(isReasoningInterrupted(segments, false)).toBe(true);
  });

  it("is false once reasoning has closed, regardless of active-generation state", () => {
    const segments = segmentReasoning("<think>done</think>Answer.");
    expect(isReasoningInterrupted(segments, false)).toBe(false);
    expect(isReasoningInterrupted(segments, true)).toBe(false);
  });

  it("is false when there was never any reasoning at all", () => {
    const segments = segmentReasoning("Just a plain answer.");
    expect(isReasoningInterrupted(segments, false)).toBe(false);
  });
});

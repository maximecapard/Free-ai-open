import { describe, expect, it } from "vitest";
import { isMessageContinuable } from "./continuationEligibility";

describe("isMessageContinuable", () => {
  it("is never continuable for a user message", () => {
    expect(isMessageContinuable({ role: "user", content: "<think>open", status: "incomplete" })).toBe(false);
  });

  it("is continuable when explicitly marked incomplete, even with plain closed content", () => {
    expect(isMessageContinuable({ role: "assistant", content: "cut off mid", status: "incomplete" })).toBe(true);
  });

  it("is not continuable once a reply is marked complete", () => {
    expect(isMessageContinuable({ role: "assistant", content: "A full answer.", status: "complete" })).toBe(false);
  });

  it("is continuable for an old, pre-feature message with an unclosed <think> block and no status field at all -- the real BeautifulSoup export case", () => {
    expect(
      isMessageContinuable({
        role: "assistant",
        content: "<think>\nOkay, the user is asking for an example of a parser algorithm",
      })
    ).toBe(true);
  });

  it("is not continuable for an old message whose reasoning already closed, even with no status field", () => {
    expect(isMessageContinuable({ role: "assistant", content: "<think>done</think>Bonjour !" })).toBe(false);
  });

  it("is not continuable for a plain old message with no reasoning markup and no status field", () => {
    expect(isMessageContinuable({ role: "assistant", content: "Bonjour ! Comment puis-je vous aider ?" })).toBe(false);
  });

  it("item 10 (mandatory): is not continuable once truncated to fit the local storage ceiling, even though it is otherwise marked incomplete", () => {
    expect(
      isMessageContinuable({
        role: "assistant",
        content: "x".repeat(64_000),
        status: "incomplete",
        incompleteReason: "truncated",
      })
    ).toBe(false);
  });
});

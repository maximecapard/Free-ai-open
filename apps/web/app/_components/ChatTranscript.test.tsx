import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../_i18n/LocaleContext";
import { ChatTranscript } from "./ChatTranscript";
import type { ChatMessageItem } from "./ChatTranscript";

// Same static-rendering approach as MessageContent.test.tsx -- this repo's
// default test environment has no DOM.
function renderTranscript(messages: ChatMessageItem[], activeAssistantMessageId: string | null = null): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <ChatTranscript messages={messages} activeAssistantMessageId={activeAssistantMessageId} />
    </LocaleProvider>
  );
}

// The exact reasoning prefix from a real user-exported conversation
// (freeai-open-conversation-*.json) where qwen3-4b spent its entire output
// budget inside an unclosed <think> block -- see docs/architecture.md's
// "Reasoning output and finish reason" section. This message predates the
// reasoning-disclosure feature entirely: it was persisted with no `status`
// field at all, the same shape every historical conversation has.
const BEAUTIFULSOUP_INTERRUPTED_CONTENT =
  '<think>\nOkay, the user is asking for an example of a parser algorithm using BeautifulSoup. Let me start by recalling what BeautifulSoup is. It\'s a Python library for parsing HTML and XML documents. So, the user probably wants to see how to extract data from HTML using this library.\n\nFirst, I need to outline the basic steps of using BeautifulSoup. They might not be familiar with the process, so I should explain the steps clearly.';

describe("ChatTranscript reasoning rendering", () => {
  it("renders a real historical, unclosed-<think> reply (the BeautifulSoup regression case) with the generic interrupted notice and no raw <think> markup", () => {
    const messages: ChatMessageItem[] = [
      { id: "u1", role: "user", content: "tu peux me faire un exemple d'algorithme de parse avec beatyfull soup stp" },
      { id: "a1", role: "assistant", content: BEAUTIFULSOUP_INTERRUPTED_CONTENT },
    ];
    const html = renderTranscript(messages);

    expect(html).not.toContain("<think>");
    expect(html).not.toContain("</think>");
    expect(html).toContain("Okay, the user is asking for an example of a parser algorithm");
    expect(html).toContain("The generation stopped before the final answer.");
    // No separate generic "Incomplete response" label duplicating the
    // reasoning-specific notice above -- see ChatTranscript.tsx's
    // reasoningInterrupted suppression.
    expect(html).not.toContain("Incomplete response");
  });

  it("renders an old, closed-reasoning message (predating this feature, no status field) collapsed with the final answer visible and no raw markup", () => {
    const messages: ChatMessageItem[] = [
      { id: "u1", role: "user", content: "Salut ^^" },
      {
        id: "a1",
        role: "assistant",
        content: '<think>\nOkay, the user said "Salut ^^" which is a greeting.\n</think>\n\nBonjour ! Comment puis-je vous aider aujourd\'hui ?',
      },
    ];
    const html = renderTranscript(messages);

    expect(html).not.toContain("<think>");
    expect(html).not.toContain("</think>");
    // The apostrophe is HTML-entity-escaped (&#x27;) by both the Markdown
    // renderer and plain JSX text output, so match around it rather than
    // asserting a literal straight apostrophe.
    expect(html).toContain("Bonjour ! Comment puis-je vous aider aujourd");
    expect(html).toContain("hui ?");
    expect(html).not.toContain("The generation stopped before the final answer.");
  });

  it("never treats a user message's literal <think> text as reasoning markup", () => {
    const messages: ChatMessageItem[] = [{ id: "u1", role: "user", content: "What does <think> mean in your output?" }];
    const html = renderTranscript(messages);

    // User text is plain (never Markdown-parsed), so React's own JSX text
    // escaping renders the literal tag as &lt;think&gt; -- proving it was
    // never treated as reasoning markup, which is the actual thing this
    // test guards against.
    expect(html).toContain("What does &lt;think&gt; mean in your output?");
    expect(html).not.toContain("<think>");
    expect(html).not.toContain("Thinking");
  });

  it("shows the in-progress label, not the interrupted notice, while the message is the active generation", () => {
    const messages: ChatMessageItem[] = [
      { id: "u1", role: "user", content: "Explain X" },
      { id: "a1", role: "assistant", content: "<think>still reasoning" },
    ];
    const html = renderTranscript(messages, "a1");

    expect(html).toContain("Thinking…");
    expect(html).not.toContain("The generation stopped before the final answer.");
  });

  it("shows the length-specific notice only for a message this session knows was length-limited", () => {
    const messages: ChatMessageItem[] = [
      { id: "u1", role: "user", content: "Explain X" },
      { id: "a1", role: "assistant", content: "<think>ran out of room", incompleteReason: "length" },
    ];
    const html = renderTranscript(messages);

    expect(html).toContain("The generation limit was reached.");
    expect(html).not.toContain("The generation stopped before the final answer.");
  });

  it("suppresses the generic incomplete label when reasoning interruption already explains it, avoiding a duplicate notice", () => {
    const messages: ChatMessageItem[] = [
      { id: "u1", role: "user", content: "Explain X" },
      { id: "a1", role: "assistant", content: "<think>cut off", status: "incomplete" },
    ];
    const html = renderTranscript(messages);

    expect(html).toContain("The generation stopped before the final answer.");
    // ChatTranscript.tsx's generic incompleteMessageLabel path is gated on
    // !reasoningInterrupted -- it must not additionally render here.
    expect(html).not.toContain("Incomplete response");
  });

  it("still shows the generic incomplete label for a plain (non-reasoning) incomplete reply", () => {
    const messages: ChatMessageItem[] = [
      { id: "u1", role: "user", content: "Explain X" },
      { id: "a1", role: "assistant", content: "Here is a partial answer that got cut off", status: "incomplete" },
    ];
    const html = renderTranscript(messages);

    expect(html).not.toContain("The generation stopped before the final answer.");
    expect(html).toContain("Incomplete response");
  });
});

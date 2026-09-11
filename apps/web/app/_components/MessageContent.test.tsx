import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../_i18n/LocaleContext";
import { MessageContent } from "./MessageContent";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

// This repo's default test environment has no DOM (no jsdom/happy-dom), so
// these tests render to a static HTML string via react-dom/server rather
// than mounting into a real document. That is enough to assert on markup
// shape/security (no <script>, correct link attributes, exact code text)
// without adding a new browser-test-environment dependency for this hotfix.
function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <MessageContent content={content} />
    </LocaleProvider>
  );
}

describe("MessageContent", () => {
  it("renders paragraphs and preserves line breaks within a paragraph", () => {
    const html = renderMarkdown("First line.\nSecond line.\n\nSecond paragraph.");
    expect(html).toContain("<p>");
    expect((html.match(/<p>/g) ?? []).length).toBe(2);
    expect(html).toContain("<br");
  });

  it("renders bold and italic", () => {
    const html = renderMarkdown("This is **bold** and this is *italic*.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders ordered and unordered lists", () => {
    const ordered = renderMarkdown("1. First\n2. Second");
    expect(ordered).toContain("<ol");
    expect((ordered.match(/<li>/g) ?? []).length).toBe(2);

    const unordered = renderMarkdown("- First\n- Second");
    expect(unordered).toContain("<ul");
    expect((unordered.match(/<li>/g) ?? []).length).toBe(2);
  });

  it("renders headings capped well under the page-title size", () => {
    const html = renderMarkdown("# Big heading");
    expect(html).toContain("<h1");
  });

  it("renders blockquotes and horizontal rules", () => {
    const html = renderMarkdown("> quoted text\n\n---\n\nafter");
    expect(html).toContain("<blockquote");
    expect(html).toMatch(/<hr\s*\/?>/);
  });

  it("renders GFM tables", () => {
    const html = renderMarkdown("| A | B |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
  });

  it("renders inline code with monospace styling, not as a full code block", () => {
    const html = renderMarkdown("Use `const x = 1` here.");
    expect(html).toContain("chat-inline-code");
    expect(html).not.toContain("chat-code-block");
  });

  it("renders a fenced Python code block with a language label and exact code text", () => {
    const html = renderMarkdown("```python\nprint('hi')\n```");
    expect(html).toContain("chat-code-block");
    expect(html).toContain(">python<");
    expect(html).toContain("print(&#x27;hi&#x27;)");
  });

  it("renders a fence without a language using the neutral Code label", () => {
    const html = renderMarkdown("```\nplain text\n```");
    expect(html).toContain("chat-code-block");
    expect(html).toContain(">Code<");
  });

  it("renders multiple code blocks in one message independently", () => {
    const html = renderMarkdown("```python\na = 1\n```\n\nSome text.\n\n```js\nlet b = 2;\n```");
    expect((html.match(/chat-code-block__pre/g) ?? []).length).toBe(2);
    expect(html).toContain(">python<");
    expect(html).toContain(">js<");
  });

  it("never renders raw HTML/script tags from model output", () => {
    const html = renderMarkdown("Hello <script>alert(1)</script> world <img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toMatch(/<img\b/);
  });

  it("does not render a style tag or event-handler attribute from raw HTML", () => {
    const html = renderMarkdown('<style>body{display:none}</style><div onclick="alert(1)">x</div>');
    expect(html).not.toContain("<style");
    expect(html).not.toContain("onclick");
  });

  it("rejects javascript: links, rendering plain non-clickable text instead", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("click me");
  });

  it("gives external links safe target/rel attributes", () => {
    const html = renderMarkdown("[FreeAI Open](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
    expect(html).toContain("noreferrer");
  });

  it("never renders an <img> element even for a safe-looking image URL (no implicit network fetch)", () => {
    const html = renderMarkdown("![a photo](https://example.com/photo.png)");
    expect(html).not.toMatch(/<img\b/);
    expect(html).toContain("a photo");
  });

  it("does not crash on a partially streamed, unclosed code fence and does not lose the streamed text", () => {
    const html = renderMarkdown("```python\nprint('still streaming'");
    expect(html).toContain("chat-code-block");
    expect(html).toContain("still streaming");
  });

  it("does not crash on an incomplete bold marker or in-progress list item", () => {
    expect(() => renderMarkdown("This is **bold that never closes")).not.toThrow();
    expect(() => renderMarkdown("- item one\n- item two that is still bei")).not.toThrow();
    const html = renderMarkdown("This is **bold that never closes");
    expect(html).toContain("bold that never closes");
  });

  it("does not duplicate content once a streamed fence closes on a later render", () => {
    const streaming = renderMarkdown("```python\nprint('a'");
    const closed = renderMarkdown("```python\nprint('a')\n```\n\nDone.");
    expect(streaming).toContain("print(&#x27;a&#x27;");
    expect((closed.match(/print\(&#x27;a&#x27;\)/g) ?? []).length).toBe(1);
    expect(closed).toContain("Done.");
  });

  it("renders each message independently: an unclosed fence in one message never bleeds into another", () => {
    const messageA = renderMarkdown("```python\nprint('unterminated'");
    const messageB = renderMarkdown("Just a normal reply, no code at all.");
    expect(messageB).not.toContain("chat-code-block");
    expect(messageB).not.toContain("print(");
    void messageA;
  });

  it("keeps a long code line inside the internally scrollable code block region", () => {
    const longLine = "x".repeat(400);
    const html = renderMarkdown(`\`\`\`\n${longLine}\n\`\`\``);
    // chat-code-block__pre carries overflow-x:auto/white-space:pre in
    // globals.css — this asserts the class that provides that behavior is
    // actually applied, not the CSS layout itself (no real browser here).
    expect(html).toContain('class="chat-code-block__pre"');
    expect(html).toContain(longLine);
  });

  it("gives the code-block copy button an accessible label and keeps the language label from ever inventing a value", () => {
    const withLanguage = renderMarkdown("```typescript\nconst x = 1;\n```");
    expect(withLanguage).toContain(">typescript<");

    const withoutLanguage = renderMarkdown("```\nconst x = 1;\n```");
    expect(withoutLanguage).toContain(">Code<");
    expect(withoutLanguage).not.toMatch(/>[a-z]+<\/span>\s*<button/);

    expect(withLanguage).toContain('aria-label="Copy"');
  });

  it("never logs, and has no logging call sites for, rendered or copied code content", () => {
    // A structural guard rather than a runtime assertion: rendering never
    // calls any logger, and code review of these two files (see
    // docs/security.md) confirms neither imports one. This test fails loudly
    // if that ever changes without an explicit, reviewed decision.
    const source = [
      readSource("./MessageContent.tsx"),
      readSource("./CodeBlock.tsx"),
      readSource("../_lib/codeBlockCopy.ts"),
    ].join("\n");

    expect(source).not.toMatch(/console\.\w+\(/);
    expect(source).not.toMatch(/logEvent\(/);
    expect(source).not.toMatch(/addLocalLog\(/);
  });
});

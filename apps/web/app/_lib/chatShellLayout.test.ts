import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(new URL("../globals.css", import.meta.url), "utf8");
const chatLayout = readFileSync(new URL("../chat/layout.tsx", import.meta.url), "utf8");
const chatPage = readFileSync(new URL("../chat/page.tsx", import.meta.url), "utf8");

function ruleBody(selector: string, source: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

function desktopMediaBlock(): string {
  const start = globalsCss.indexOf("@media (min-width: 721px) {");
  expect(start).toBeGreaterThan(-1);
  // The desktop chat-shell block is immediately followed by the modal rules
  // (unrelated), so slice up to that marker rather than trying to balance
  // braces by hand.
  const end = globalsCss.indexOf(".fo-modal-backdrop", start);
  expect(end).toBeGreaterThan(start);
  return globalsCss.slice(start, end);
}

describe("desktop chat workspace layout", () => {
  it("gives /chat its own nested route layout, so other routes keep normal page scrolling", () => {
    expect(chatLayout).toContain('className="chat-shell"');
  });

  it("lets the root shell own the viewport height on desktop", () => {
    const appShellBlock = ruleBody(".app-shell:has(.chat-shell)", desktopMediaBlock());
    const appMainBlock = ruleBody(".app-shell__main:has(> .chat-shell)", desktopMediaBlock());

    expect(appShellBlock).toContain("height: 100dvh");
    expect(appShellBlock).toContain("overflow: hidden");
    expect(appMainBlock).toContain("min-height: 0");
    expect(appMainBlock).toContain("overflow: hidden");
  });

  it("sizes the chat shell to the remaining app-main height on desktop", () => {
    const block = ruleBody(".chat-shell", desktopMediaBlock());
    expect(block).toContain("height: 100%");
  });

  it("marks every nested flex region min-height: 0, the standard fix for flexbox children refusing to shrink and scroll", () => {
    const block = desktopMediaBlock();
    const minHeightZeroCount = (block.match(/min-height:\s*0/g) ?? []).length;
    expect(minHeightZeroCount).toBeGreaterThanOrEqual(3);
  });

  it("gives the sidebar and the message list their own independent overflow-y: auto regions", () => {
    const block = desktopMediaBlock();
    const historyListBlock = ruleBody(".chat-history-list", block);
    const scrollBlock = ruleBody(".chat-main__scroll", block);

    expect(historyListBlock).toContain("overflow-y: auto");
    expect(scrollBlock).toContain("overflow-y: auto");
  });

  it("keeps the composer outside the scrolling region so it stays anchored at the bottom", () => {
    const block = desktopMediaBlock();
    const composerBlock = ruleBody(".chat-main__composer", block);
    expect(composerBlock).toContain("flex-shrink: 0");
  });

  it("hides the page footer only for the chat route, not globally", () => {
    expect(globalsCss).toContain(".app-shell__main:has(> .chat-shell) + .app-footer");
    // The rule must live inside the desktop-only media query, not at the
    // top level, so unrelated public pages never lose their footer.
    expect(desktopMediaBlock()).toContain(".app-shell__main:has(> .chat-shell) + .app-footer");
  });

  it("splits the chat page into a static header, a scrolling transcript region, and an anchored composer", () => {
    expect(chatPage).toContain('className="chat-main__header"');
    expect(chatPage).toContain('className="chat-main__scroll"');
    expect(chatPage).toContain('className="chat-main__composer"');
    expect(chatPage).toContain("scrollContainerRef={transcriptScrollRef}");
  });
});

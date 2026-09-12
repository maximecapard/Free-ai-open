import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../_i18n/LocaleContext";
import { didReasoningJustClose, ReasoningDisclosure } from "./ReasoningDisclosure";
import type { ReasoningDisclosureProps } from "./ReasoningDisclosure";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

// Same static-rendering approach as MessageContent.test.tsx -- this repo's
// default test environment has no DOM. That only captures the INITIAL
// render (the auto-collapse-on-close useEffect never runs here), so these
// tests assert on the markup/label/notice shown for a given
// (reasoningOpen, isActiveGeneration, lengthLimited) combination, not on the
// live transition between them.
function renderDisclosure(props: ReasoningDisclosureProps): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <ReasoningDisclosure {...props} />
    </LocaleProvider>
  );
}

describe("ReasoningDisclosure", () => {
  it("shows the in-progress label and stays open while actively streaming with an open think block", () => {
    const html = renderDisclosure({ reasoning: "still thinking", reasoningOpen: true, isActiveGeneration: true });
    expect(html).toContain("Thinking…");
    expect(html).toMatch(/<details[^>]*\bopen\b/);
    expect(html).not.toContain("The generation stopped before the final answer.");
  });

  it("shows the static label and the generic interrupted notice once generation is no longer active", () => {
    const html = renderDisclosure({ reasoning: "cut off mid-thought", reasoningOpen: true, isActiveGeneration: false });
    expect(html).toContain(">Thinking<");
    expect(html).not.toContain("Thinking…");
    expect(html).toContain("The generation stopped before the final answer.");
    expect(html).toMatch(/<details[^>]*\bopen\b/);
  });

  it("shows the length-specific notice only when lengthLimited is known for this session's own generation", () => {
    const html = renderDisclosure({
      reasoning: "ran out of budget",
      reasoningOpen: true,
      isActiveGeneration: false,
      lengthLimited: true,
    });
    expect(html).toContain("The generation limit was reached.");
    expect(html).not.toContain("The generation stopped before the final answer.");
  });

  it("shows no interrupted notice once reasoning has closed, regardless of active-generation state", () => {
    const active = renderDisclosure({ reasoning: "done", reasoningOpen: false, isActiveGeneration: true });
    const inactive = renderDisclosure({ reasoning: "done", reasoningOpen: false, isActiveGeneration: false });
    expect(active).not.toContain("The generation stopped before the final answer.");
    expect(inactive).not.toContain("The generation stopped before the final answer.");
    expect(inactive).not.toContain("The generation limit was reached.");
  });

  it("renders reasoning content through the same safe Markdown renderer as the final answer", () => {
    const html = renderDisclosure({
      reasoning: "Hello <script>alert(1)</script> **bold**",
      reasoningOpen: false,
      isActiveGeneration: false,
    });
    expect(html).not.toContain("<script");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("never logs, and has no logging call sites for, reasoning content", () => {
    // A structural guard, mirroring MessageContent.test.tsx's equivalent
    // check: reasoning is presentation-only and must never reach a logger.
    const source = [readSource("./ReasoningDisclosure.tsx"), readSource("../_lib/reasoningSegmentation.ts")].join("\n");

    expect(source).not.toMatch(/console\.\w+\(/);
    expect(source).not.toMatch(/logEvent\(/);
    expect(source).not.toMatch(/addLocalLog\(/);
  });

  it("marks the streaming label as an aria-live region so a screen reader hears it change without refocusing", () => {
    const html = renderDisclosure({ reasoning: "still thinking", reasoningOpen: true, isActiveGeneration: true });
    expect(html).toMatch(/aria-live="polite"[^>]*aria-atomic="true"[^>]*>Thinking(&#8230;|\.\.\.|\u2026)/);
  });

  it("gives the interrupted notice a live region via role=status", () => {
    const html = renderDisclosure({ reasoning: "cut off", reasoningOpen: true, isActiveGeneration: false });
    expect(html).toMatch(/role="status"[^>]*>The generation stopped/);
  });

  it("item 8 (mandatory): never puts the streamed reasoning content itself inside the aria-live region -- only the short, rarely-changing label", () => {
    // A screen reader must hear the label change once (Thinking... ->
    // Thinking), never every streamed token of the reasoning body -- that
    // would be an unusable wall of announcements during a long generation.
    const marker = "UNIQUE_STREAMED_TOKEN_TEXT_MARKER_12345";
    const html = renderDisclosure({ reasoning: marker, reasoningOpen: true, isActiveGeneration: true });

    // The marker is genuinely rendered somewhere (the reasoning body) --
    // this is not a vacuously-true assertion from the text never appearing.
    expect(html).toContain(marker);

    const ariaLiveSpanMatch = html.match(/<span aria-live="polite"[^>]*>([\s\S]*?)<\/span>/);
    expect(ariaLiveSpanMatch).not.toBeNull();
    expect(ariaLiveSpanMatch?.[1]).not.toContain(marker);
  });

  it("item 8 (mandatory): auto-collapse never moves focus -- the effect only ever updates state, never calls a focus API", () => {
    // There is no DOM/focus system in this repo's default test environment
    // (see this file's own top comment), so this is verified structurally:
    // the component contains no focus-manipulating call at all, and the
    // auto-collapse effect's body is exactly the state update + ref
    // bookkeeping described in didReasoningJustClose's doc comment, nothing
    // else that could shift focus when a message quietly finishes
    // reasoning out of the user's current attention.
    const source = readSource("./ReasoningDisclosure.tsx");
    expect(source).not.toMatch(/\.focus\(/);
    expect(source).not.toMatch(/autoFocus/);
    expect(source).not.toMatch(/tabIndex/);

    const effectBodyMatch = source.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[[^\]]*\]\);/);
    expect(effectBodyMatch).not.toBeNull();
    expect(effectBodyMatch?.[1]).not.toMatch(/\.focus\(/);
  });
});

// The React re-render/click lifecycle needed to fully exercise this in a
// mounted DOM is out of scope here (this repo's default test environment
// has no DOM -- see MessageContent.test.tsx's own note), so the
// auto-collapse DECISION itself is extracted as didReasoningJustClose() and
// tested directly: the "streaming open -> expanded, then closes ->
// collapsed once, then user can reopen it" flow reduces to (a) this
// function returning true on exactly the transition that should force a
// collapse and false on every other transition, and (b) the component
// effect only ever calling setIsOpen(false) when this returns true, never
// reacting to isOpen itself -- so a later manual reopen can never be undone
// by this same effect. Point (b) is a static property of the source (the
// effect's dependency array is [reasoningOpen] only), verified once here by
// re-reading the source rather than by simulating a click.
describe("didReasoningJustClose", () => {
  it("is true only on a genuine open-to-closed transition", () => {
    expect(didReasoningJustClose(true, false)).toBe(true);
  });

  it("is false while still streaming (open stays open)", () => {
    expect(didReasoningJustClose(true, true)).toBe(false);
  });

  it("is false once already closed (nothing left to collapse)", () => {
    expect(didReasoningJustClose(false, false)).toBe(false);
  });

  it("is false for a reopen (closed-to-open), so a real transition here is never mistaken for a collapse", () => {
    expect(didReasoningJustClose(false, true)).toBe(false);
  });

  it("the effect that calls this never reacts to the disclosure's own open/closed state, so a manual reopen after auto-collapse can never be forced shut again", () => {
    const source = readSource("./ReasoningDisclosure.tsx");
    const effectMatch = source.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\);/);
    expect(effectMatch).not.toBeNull();
    // The dependency array must be exactly [reasoningOpen] -- if isOpen (or
    // anything derived from it) were ever added here, the effect could fire
    // again after a manual reopen and re-force it closed, which is exactly
    // the "fighting a user's own manual toggle" bug this design avoids.
    expect(effectMatch?.[1]?.trim()).toBe("reasoningOpen");
  });
});

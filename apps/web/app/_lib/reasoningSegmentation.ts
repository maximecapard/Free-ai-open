// Splits raw assistant output into an optional reasoning segment (a Qwen3-
// style <think>...</think> block) and the visible final-answer text around
// it. Pure, presentation-layer only: the persisted/exported message content
// is always the original raw string (see docs/architecture.md's "Reasoning
// output and finish reason" section) -- this function never mutates or
// re-saves anything, it only tells the renderer how to present one string.
//
// Deliberately a plain string scan, not a general HTML/XML parser: <think>
// is a single well-known marker emitted at the very start of a Qwen3 chat-
// template response when thinking is enabled, never nested, never carrying
// attributes. A message with no <think> tag at all (most models, or a
// thinking-disabled request) is treated as pure final-answer text -- the
// overwhelmingly common case -- with no special handling.
//
// <think> is ONLY ever recognized as a reasoning-opening control marker
// when it is the FIRST MEANINGFUL content of the assistant's entire output
// -- i.e. content.trimStart() starts with it, ignoring only leading
// whitespace/newlines. Qwen3's chat template always emits <think> (if at
// all) as the very first thing in the turn; a real model never opens
// reasoning after it has already written visible answer text. This means a
// LATER occurrence of the literal text "<think>" -- inside an explanation
// of raw HTML, a worked example, a nested/nonsensical second tag, or any
// other prose -- is always just text, whether or not it happens to sit
// inside a fenced code block or inline code span: e.g. a response
// explaining `<div> <think>visible HTML example</think> </div>` in normal
// prose must render that literally, never open a reasoning panel, exactly
// as if it had appeared in code. Only the FIRST, leading <think>/</think>
// pair is ever treated as reasoning; anything after the reasoning block
// closes -- including further literal "<think>"/"</think>" text -- is
// final-answer content and is never re-interpreted as additional hidden
// reasoning.
//
// The closing </think> search remains Markdown-aware: a literal
// "</think>" that appears inside a PROPERLY CLOSED fenced code block
// (backtick- or tilde-fenced, with a real matching closing fence line) or
// an inline code span WITHIN a real leading reasoning block is never
// mistaken for the real close tag -- a model showing example HTML/XML
// containing that literal text while still reasoning must not prematurely
// end the reasoning segment there. An UNTERMINATED fence -- one with no
// matching closing line anywhere in the content -- is deliberately NOT
// treated as protecting anything: malformed Markdown inside reasoning
// (the model opens a fence, then forgets to close it before writing its
// own </think> and final answer) must never be able to hide the real
// outer </think> terminator and swallow the rest of the message into the
// reasoning panel forever. See findFencedCodeRanges()'s own doc comment.
const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

export interface ReasoningSegments {
  // Text before a real leading <think> tag -- in practice this is always
  // either "" (no reasoning detected at all) or purely the leading
  // whitespace/newlines skipped over to find it, since a real reasoning
  // tag is never recognized unless it is the first MEANINGFUL content.
  // Preserved rather than discarded so no content is ever silently lost.
  beforeReasoning: string;
  // Content between <think> and </think> (or from <think> to the end of
  // the string if there is no closing tag yet). Null when no LEADING
  // <think> tag is present -- a <think> occurring later in the content is
  // never reasoning, see this module's top doc comment.
  reasoning: string | null;
  // True when a leading <think> tag was found but no matching </think> has
  // arrived yet -- either still streaming, or the generation ended while
  // reasoning was still open (see isReasoningInterrupted in the caller,
  // which also needs to know whether generation is still actually active).
  reasoningOpen: boolean;
  // The final-answer text after </think>. Empty while reasoningOpen is
  // true, since there is nothing after an unclosed block yet.
  afterReasoning: string;
}

interface CodeRange {
  start: number;
  end: number;
}

// A line consisting of (up to 3 leading spaces, per CommonMark) 3+ backticks
// or 3+ tildes, followed by anything, is a CANDIDATE fence line -- either a
// genuine OPENING fence (any trailing info string is allowed here, e.g.
// "```python") or a candidate CLOSE that still needs its own stricter
// validation (see isValidClosingFenceLine()) before being accepted as one.
const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})[^\n]*$/gm;

// Whether `line` (the FULL raw text of one physical line, leading
// indentation included, exactly as matched by FENCE_LINE_PATTERN) is a
// valid CLOSING fence for a fence that was opened with `openingMarker`.
//
// Unlike an opening fence, a closing fence may carry NO trailing content
// beyond spaces/tabs -- no information string, no punctuation, no
// arbitrary text. A line like "~~~not-a-closing-fence" or "~~~ nope" only
// ever opens a fence; treating it as a valid close (as an earlier version
// of this function did, by checking only the marker character and length)
// let a stray pseudo-fence line anywhere later in the message retroactively
// "close" an already-open fence, silently absorbing a real outer </think>
// terminator -- and everything after it -- into what looked like still-
// open code.
//
// Deliberately a small explicit parser, not a single permissive regex, so
// each rule is independently obvious and auditable:
//   1. up to 3 leading spaces (a 4th disqualifies the line outright, the
//      same cap FENCE_LINE_PATTERN itself enforces -- re-derived here from
//      the raw line rather than trusted from the caller, so this function
//      is correct standalone and a 4-space-indented candidate can never be
//      accepted no matter how it reaches this function);
//   2. the marker character must match the opening fence's exactly
//      (backtick only closes backtick, tilde only closes tilde);
//   3. the run of marker characters must be at least as long as the
//      opening fence's (a longer closing run, e.g. opening ~~~ closed by
//      ~~~~~, is valid; a shorter one is not);
//   4. everything after the marker run must be spaces/tabs only.
// A trailing "\r" (a CRLF-terminated line) is stripped first so line-
// ending style never changes the result.
export function isValidClosingFenceLine(line: string, openingMarker: string): boolean {
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;

  let index = 0;
  while (index < 3 && text[index] === " ") {
    index += 1;
  }
  if (text[index] === " ") return false; // a 4th leading space: not a fence line at all

  const markerChar = openingMarker[0];
  if (!markerChar || text[index] !== markerChar) return false;

  let markerLength = 0;
  while (text[index + markerLength] === markerChar) {
    markerLength += 1;
  }
  if (markerLength < openingMarker.length) return false;

  for (const character of text.slice(index + markerLength)) {
    if (character !== " " && character !== "\t") return false;
  }

  return true;
}

// Every fenced code block's content range -- but ONLY for a fence that is
// actually closed by a real, validly-formed matching fence line somewhere
// in the content. An opening fence with no valid matching close
// (malformed/truncated Markdown, e.g. the model opens a ```/~~~ block
// inside its reasoning and never properly closes it before emitting its
// own </think>) contributes NO range at all here: it must never be
// allowed to protect the remainder of the message indefinitely, since
// that would hide a genuine outer </think> terminator -- and everything
// after it, including the final answer -- inside what looks like an
// unterminated code block forever (see this module's top doc comment for
// the exact bug this guards against). This intentionally diverges from
// CommonMark's own "unterminated fence extends to end of input" rule,
// which is the correct behavior for actually RENDERING Markdown (see
// MessageContent.tsx/react-markdown, unaffected by this function) but the
// wrong one for finding a structural </think> control marker: a fence
// closing is Markdown's own business, not reasoning's. A candidate line
// that fails isValidClosingFenceLine() is simply literal content of the
// still-open fence -- it never accidentally closes it, and (since only one
// fence can be open at a time here) it never opens a new one either.
function findFencedCodeRanges(content: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  let openFence: { marker: string; contentStart: number } | null = null;

  FENCE_LINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_LINE_PATTERN.exec(content)) !== null) {
    const lineStart = match.index;
    const lineEnd = match.index + match[0].length;

    if (!openFence) {
      openFence = { marker: match[1] ?? "", contentStart: Math.min(lineEnd + 1, content.length) };
      continue;
    }

    if (isValidClosingFenceLine(match[0], openFence.marker)) {
      ranges.push({ start: openFence.contentStart, end: lineStart });
      openFence = null;
    }
  }

  return ranges;
}

function isWithinRanges(index: number, ranges: readonly CodeRange[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

// The exact span of the marker run (just the backticks/tildes themselves,
// not the whole line) for EVERY fence-CANDIDATE line -- regardless of
// whether that line goes on to successfully open or close a fence. A
// backtick run positioned like this (the first thing on its line, after at
// most 3 leading spaces) is structurally a fence marker, never inline-code
// syntax -- even when it fails isValidClosingFenceLine() and so does not
// actually close anything. Without this exclusion, a pseudo-closing
// backtick "fence" line (e.g. "```not-a-closing-fence", which correctly
// fails to close a ``` fence above) would still be picked up as a bare
// backtick run by findInlineCodeRanges() below and could pair with ANOTHER
// unrelated backtick run elsewhere into a bogus multi-line "inline span" --
// exactly as capable of hiding a real outer </think> terminator as the
// original unterminated-fence bug this whole module guards against. This
// is backtick-specific: tildes are never inline-code syntax, so this
// interaction cannot occur for tilde fences.
function findFenceMarkerRanges(content: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  FENCE_LINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_LINE_PATTERN.exec(content)) !== null) {
    const marker = match[1] ?? "";
    const markerStart = match.index + match[0].indexOf(marker);
    ranges.push({ start: markerStart, end: markerStart + marker.length });
  }
  return ranges;
}

// Inline code spans (`` `code` ``), restricted to text not already covered
// by a fenced range or a fence-candidate line's own marker (both passed in
// via `exclude`) -- a backtick run inside a fenced block, or one that is
// itself a fence marker, is never a new inline-span delimiter. Follows
// CommonMark's own pairing rule closely enough for this app's purposes: an
// opening run of N backticks is closed by the NEXT run of exactly N
// backticks, and content between them (including differently-sized runs)
// is the span.
function findInlineCodeRanges(content: string, exclude: readonly CodeRange[]): CodeRange[] {
  const runs: Array<{ start: number; end: number; length: number }> = [];
  const backtickRunPattern = /`+/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRunPattern.exec(content)) !== null) {
    if (isWithinRanges(match.index, exclude)) continue;
    runs.push({ start: match.index, end: match.index + match[0].length, length: match[0].length });
  }

  const ranges: CodeRange[] = [];
  let i = 0;
  while (i < runs.length) {
    const open = runs[i]!;
    let closeIndex = -1;
    for (let j = i + 1; j < runs.length; j += 1) {
      if (runs[j]!.length === open.length) {
        closeIndex = j;
        break;
      }
    }

    if (closeIndex === -1) {
      i += 1;
      continue;
    }

    ranges.push({ start: open.end, end: runs[closeIndex]!.start });
    i = closeIndex + 1;
  }

  return ranges;
}

function findCodeRanges(content: string): CodeRange[] {
  const fenced = findFencedCodeRanges(content);
  const fenceMarkers = findFenceMarkerRanges(content);
  const inline = findInlineCodeRanges(content, [...fenced, ...fenceMarkers]);
  return [...fenced, ...inline];
}

// The next occurrence of `marker` at or after `fromIndex` that does not fall
// inside any of `codeRanges` -- skipping over any occurrence that is purely
// literal example text inside code.
function indexOfOutsideCode(content: string, marker: string, fromIndex: number, codeRanges: readonly CodeRange[]): number {
  let index = content.indexOf(marker, fromIndex);
  while (index !== -1 && isWithinRanges(index, codeRanges)) {
    index = content.indexOf(marker, index + 1);
  }
  return index;
}

// Index of the first non-whitespace character, or content.length if the
// string is empty or entirely whitespace. Deliberately uses the same
// notion of whitespace as String.prototype.trimStart (Unicode whitespace,
// not just ASCII space/newline), so a message with e.g. a leading
// non-breaking space or full-width space in front of <think> still counts.
function leadingWhitespaceLength(content: string): number {
  return content.length - content.trimStart().length;
}

export function segmentReasoning(content: string): ReasoningSegments {
  const openIndex = leadingWhitespaceLength(content);

  // A <think> tag only ever counts as a reasoning-opening control marker
  // when it is the very first meaningful content of the assistant's
  // output -- see this module's top doc comment. Requiring the leading
  // position also means an opening tag can never legitimately sit inside a
  // fenced code block or inline code span (either would require other
  // meaningful content -- the fence markers, or backticks -- to appear
  // first), so no code-range check is needed for the OPEN tag specifically.
  if (!content.startsWith(THINK_OPEN, openIndex)) {
    return { beforeReasoning: content, reasoning: null, reasoningOpen: false, afterReasoning: "" };
  }

  const beforeReasoning = content.slice(0, openIndex);
  const afterOpenIndex = openIndex + THINK_OPEN.length;
  const codeRanges = findCodeRanges(content);
  const closeIndex = indexOfOutsideCode(content, THINK_CLOSE, afterOpenIndex, codeRanges);

  if (closeIndex === -1) {
    return {
      beforeReasoning,
      reasoning: content.slice(afterOpenIndex),
      reasoningOpen: true,
      afterReasoning: "",
    };
  }

  return {
    beforeReasoning,
    reasoning: content.slice(afterOpenIndex, closeIndex),
    reasoningOpen: false,
    afterReasoning: content.slice(closeIndex + THINK_CLOSE.length),
  };
}

// A message is "interrupted mid-reasoning" only when its <think> block is
// still open AND it is no longer the actively streaming generation --
// otherwise an ordinary in-progress "Thinking..." panel would incorrectly
// flash the interrupted notice on every message while it is still being
// generated normally.
export function isReasoningInterrupted(segments: ReasoningSegments, isActiveGeneration: boolean): boolean {
  return segments.reasoningOpen && !isActiveGeneration;
}

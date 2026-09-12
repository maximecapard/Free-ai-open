"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "../_i18n/LocaleContext";
import { MessageContent } from "./MessageContent";

export interface ReasoningDisclosureProps {
  // Raw reasoning text between <think> and </think> (or to the end of the
  // string if still open) -- see reasoningSegmentation.ts. Rendered through
  // the same safe Markdown renderer as the final answer, since reasoning can
  // itself contain Markdown/code.
  reasoning: string;
  // True while a <think> tag is present with no matching </think> yet.
  reasoningOpen: boolean;
  // True only for the message currently being streamed by the active
  // generation. Distinguishes "still actively thinking right now" from "the
  // think block is open but generation has already stopped" (interrupted).
  isActiveGeneration: boolean;
  // Known only for a message that just finished generating in this session
  // (see AppRuntimeProvider.tsx) -- never available for a reloaded/historical
  // conversation, which falls back to the generic interrupted notice.
  lengthLimited?: boolean;
}

// The auto-collapse decision, extracted as a pure function so it has direct
// unit-test coverage independent of React's render/effect lifecycle (this
// repo's default test environment has no DOM -- see MessageContent.test.tsx
// -- so a full mount-rerender-click simulation is out of scope here; this
// function is the part of that flow that actually decides anything, and the
// two static-render tests in ReasoningDisclosure.test.tsx cover its two
// output shapes before and after the transition it detects). True only on a
// genuine true-to-false transition -- never on false-to-false (nothing to
// collapse), true-to-true (still open), or false-to-true (reopening is
// always the user's own action via onToggle, never forced by this effect).
export function didReasoningJustClose(previousReasoningOpen: boolean, currentReasoningOpen: boolean): boolean {
  return previousReasoningOpen && !currentReasoningOpen;
}

// A focused, native <details>/<summary> disclosure for a Qwen3-style <think>
// reasoning block -- never raw <think> tags in the transcript. Expanded by
// default while reasoning is open (actively streaming or interrupted mid-
// thought, so partial reasoning is never hidden by default); collapses
// itself exactly once, automatically, the moment </think> arrives, without
// fighting a user's own manual toggle afterward -- once collapsed by this
// effect or reopened by the user, only a NEW true-to-false transition (a
// message starting a fresh <think> block, which never happens to an already-
// closed one) can force it again; a manual reopen is never undone, since
// nothing here reacts to isOpen changing. <details>/<summary> are natively
// keyboard accessible (native focus-visible styling applies automatically)
// and work identically on mobile with a 44px coarse-pointer touch target
// (globals.css); no animation is added beyond the existing design system.
export function ReasoningDisclosure({ reasoning, reasoningOpen, isActiveGeneration, lengthLimited }: ReasoningDisclosureProps) {
  const t = useTranslations();
  const isStreamingNow = reasoningOpen && isActiveGeneration;
  const isInterrupted = reasoningOpen && !isActiveGeneration;
  const [isOpen, setIsOpen] = useState(reasoningOpen);
  const wasReasoningOpenRef = useRef(reasoningOpen);

  useEffect(() => {
    if (didReasoningJustClose(wasReasoningOpenRef.current, reasoningOpen)) setIsOpen(false);
    wasReasoningOpenRef.current = reasoningOpen;
  }, [reasoningOpen]);

  return (
    <div className="chat-reasoning">
      <details
        className="chat-reasoning__details"
        open={isOpen}
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
      >
        <summary className="chat-reasoning__summary">
          {/* aria-live so a screen reader hears the label change from
              "Thinking..." to the static "Thinking" as reasoning finishes,
              without needing to re-focus the disclosure to notice. */}
          <span aria-live="polite" aria-atomic="true">
            {isStreamingNow ? t("chat.reasoningInProgress") : t("chat.reasoningLabel")}
          </span>
        </summary>
        <div className="chat-reasoning__body">
          <MessageContent content={reasoning} />
        </div>
      </details>
      {isInterrupted && (
        <p className="chat-reasoning__interrupted-notice fo-muted" role="status">
          {lengthLimited ? t("chat.reasoningLengthLimitedNotice") : t("chat.reasoningInterruptedNotice")}
        </p>
      )}
    </div>
  );
}
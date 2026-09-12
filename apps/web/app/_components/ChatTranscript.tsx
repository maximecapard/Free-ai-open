"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { MessageIncompleteReason, MessageStatus } from "@free-ai-open/conversation-store";
import { useTranslations } from "../_i18n/LocaleContext";
import {
  getElementScrollMetrics,
  isNearPageBottom,
  isNearScrollEnd,
  isScrollableOverflow,
} from "../_lib/chatAutoscroll";
import { isReasoningInterrupted, segmentReasoning } from "../_lib/reasoningSegmentation";
import { MessageContent } from "./MessageContent";
import { ReasoningDisclosure } from "./ReasoningDisclosure";

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: MessageStatus;
  // Durable -- persisted through @free-ai-open/conversation-store (see
  // conversationMessages.ts's toChatMessageItems), unlike a session-only
  // flag, so a length-limited reply still shows its specific "generation
  // limit reached" notice after a reload/export/import, not just within the
  // same session. Absent for a message persisted before this field existed
  // (or one that isn't incomplete at all), which always falls back to the
  // generic interrupted notice.
  incompleteReason?: MessageIncompleteReason;
  // How many times this message has already been extended via the manual
  // Continue action -- persisted, so a page refresh cannot reset
  // AppRuntimeProvider.tsx's MAX_CONTINUATIONS_PER_MESSAGE bound.
  continuationCount?: number;
}

interface ChatTranscriptProps {
  messages: ChatMessageItem[];
  scrollContainerRef?: RefObject<HTMLElement | null>;
  // The assistant message id currently being streamed by the active
  // generation, if any -- see AppRuntimeProvider.tsx's "generation" state.
  // Distinguishes "still actively thinking" from "reasoning left open but
  // generation already stopped" for the reasoning disclosure below.
  activeAssistantMessageId?: string | null;
}

export const ChatTranscript = memo(function ChatTranscript({
  messages,
  scrollContainerRef,
  activeAssistantMessageId,
}: ChatTranscriptProps) {
  const t = useTranslations();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldFollowLatestRef = useRef(true);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  const latestMessageSignal = useMemo(() => {
    const lastMessage = messages.at(-1);
    return lastMessage ? `${lastMessage.id}:${lastMessage.content.length}` : "empty";
  }, [messages]);

  const scheduleScrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    if (typeof window === "undefined" || scrollFrameRef.current !== null) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      bottomRef.current?.scrollIntoView({ block: "end", behavior });
    });
  }, []);

  const getActiveScrollContainer = useCallback(() => {
    if (typeof window === "undefined") return null;
    const element = scrollContainerRef?.current ?? null;
    if (!element) return null;

    return isScrollableOverflow(window.getComputedStyle(element).overflowY) ? element : null;
  }, [scrollContainerRef]);

  const syncFollowState = useCallback(() => {
    if (typeof window === "undefined") return;

    const scrollContainer = getActiveScrollContainer();
    const isFollowing = scrollContainer
      ? isNearScrollEnd(getElementScrollMetrics(scrollContainer))
      : isNearPageBottom(window);
    shouldFollowLatestRef.current = isFollowing;
    setShowScrollToLatest(!isFollowing);
  }, [getActiveScrollContainer]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const scrollContainer = scrollContainerRef?.current ?? null;
    syncFollowState();
    window.addEventListener("scroll", syncFollowState, { passive: true });
    window.addEventListener("resize", syncFollowState);
    scrollContainer?.addEventListener("scroll", syncFollowState, { passive: true });

    return () => {
      window.removeEventListener("scroll", syncFollowState);
      window.removeEventListener("resize", syncFollowState);
      scrollContainer?.removeEventListener("scroll", syncFollowState);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, [scrollContainerRef, syncFollowState]);

  useEffect(() => {
    if (messages.length === 0) {
      setShowScrollToLatest(false);
      return;
    }

    if (shouldFollowLatestRef.current) {
      scheduleScrollToLatest();
    } else {
      setShowScrollToLatest(true);
    }
  }, [latestMessageSignal, messages.length, scheduleScrollToLatest]);

  const handleScrollToLatest = useCallback(() => {
    shouldFollowLatestRef.current = true;
    setShowScrollToLatest(false);
    scheduleScrollToLatest("smooth");
  }, [scheduleScrollToLatest]);

  if (messages.length === 0) {
    return <p className="fo-muted">{t("chat.emptyTranscript")}</p>;
  }

  return (
    <div className="chat-transcript" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {messages.map((message) => (
        <ChatMessageBubble
          key={message.id}
          message={message}
          isActiveGeneration={message.id === activeAssistantMessageId}
        />
      ))}
      {showScrollToLatest && (
        <button type="button" className="chat-scroll-latest" onClick={handleScrollToLatest}>
          {t("chat.scrollToLatest")}
        </button>
      )}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
});

const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  isActiveGeneration,
}: {
  message: ChatMessageItem;
  isActiveGeneration: boolean;
}) {
  const t = useTranslations();
  const isUser = message.role === "user";
  // Reasoning/final-answer segmentation happens only for assistant content,
  // and only at the rendering layer -- see reasoningSegmentation.ts. Raw
  // <think> markup is never shown; parsing works the same whether this
  // message is streaming right now or was loaded from an old conversation.
  const segments = isUser || !message.content ? null : segmentReasoning(message.content);
  const reasoningInterrupted = segments ? isReasoningInterrupted(segments, isActiveGeneration) : false;

  return (
    <div
      className="chat-message"
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "80%",
        padding: "10px 14px",
        borderRadius: "var(--fo-radius-card)",
        background: isUser ? "var(--fo-surface-elevated)" : "var(--fo-surface)",
        border: "1px solid var(--fo-border)",
        // Only meaningful for the plain-text user branch below — Markdown
        // rendering supplies its own paragraph/line-break structure and
        // never leaves significant raw whitespace runs for this to affect.
        whiteSpace: isUser ? "pre-wrap" : undefined,
        userSelect: "text",
      }}
    >
      {/* Alignment carries the visible distinction; this label makes role
          explicit for screen readers, since layout alone isn't announced. */}
      <span className="fo-visually-hidden">{isUser ? t("chat.youLabel") : t("chat.assistantLabel")}</span>
      {isUser ? (
        // User-entered text is shown exactly as typed, never parsed as
        // Markdown — see docs/architecture.md's "Message rendering" section
        // for why: a pasted code snippet or a "*" bullet a user typed
        // should never silently reformat or (worse) be treated as
        // executable-looking structure the user didn't intend.
        message.content
      ) : segments ? (
        <>
          {segments.beforeReasoning && <MessageContent content={segments.beforeReasoning} />}
          {segments.reasoning !== null && (
            <ReasoningDisclosure
              reasoning={segments.reasoning}
              reasoningOpen={segments.reasoningOpen}
              isActiveGeneration={isActiveGeneration}
              lengthLimited={message.incompleteReason === "length"}
            />
          )}
          {segments.afterReasoning && <MessageContent content={segments.afterReasoning} />}
        </>
      ) : (
        "…"
      )}
      {message.role === "assistant" && message.status === "incomplete" && !reasoningInterrupted && (
        <span className="fo-muted" style={{ display: "block", marginTop: 8, fontSize: "0.8125rem" }}>
          {t("chat.incompleteMessageLabel")}
        </span>
      )}
    </div>
  );
});

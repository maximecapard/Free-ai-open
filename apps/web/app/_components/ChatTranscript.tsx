"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useTranslations } from "../_i18n/LocaleContext";
import {
  getElementScrollMetrics,
  isNearPageBottom,
  isNearScrollEnd,
  isScrollableOverflow,
} from "../_lib/chatAutoscroll";
import { MessageContent } from "./MessageContent";

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "complete" | "incomplete";
}

interface ChatTranscriptProps {
  messages: ChatMessageItem[];
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

export const ChatTranscript = memo(function ChatTranscript({ messages, scrollContainerRef }: ChatTranscriptProps) {
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
        <ChatMessageBubble key={message.id} message={message} />
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

const ChatMessageBubble = memo(function ChatMessageBubble({ message }: { message: ChatMessageItem }) {
  const t = useTranslations();
  const isUser = message.role === "user";

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
      ) : message.content ? (
        <MessageContent content={message.content} />
      ) : (
        "…"
      )}
      {message.role === "assistant" && message.status === "incomplete" && (
        <span className="fo-muted" style={{ display: "block", marginTop: 8, fontSize: "0.8125rem" }}>
          {t("chat.incompleteMessageLabel")}
        </span>
      )}
    </div>
  );
});

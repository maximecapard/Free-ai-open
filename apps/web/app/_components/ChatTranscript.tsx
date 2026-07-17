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

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
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

  return (
    <div
      className="chat-message"
      style={{
        alignSelf: message.role === "user" ? "flex-end" : "flex-start",
        maxWidth: "80%",
        padding: "10px 14px",
        borderRadius: "var(--fo-radius-card)",
        background: message.role === "user" ? "var(--fo-surface-elevated)" : "var(--fo-surface)",
        border: "1px solid var(--fo-border)",
        whiteSpace: "pre-wrap",
        userSelect: "text",
      }}
    >
      {/* Alignment carries the visible distinction; this label makes role
          explicit for screen readers, since layout alone isn't announced. */}
      <span className="fo-visually-hidden">{message.role === "user" ? t("chat.youLabel") : t("chat.assistantLabel")}</span>
      {message.content || (message.role === "assistant" ? "…" : "")}
    </div>
  );
});

"use client";

import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { mobileHistoryDrawerReducer } from "../_lib/mobileHistoryDrawer";

// Must match the max-width breakpoint in globals.css that turns the history
// panel from a static sidebar into an off-canvas drawer.
const DESKTOP_MEDIA_QUERY = "(min-width: 721px)";

export function useMobileHistoryDrawer() {
  const [isOpen, dispatch] = useReducer(mobileHistoryDrawerReducer, false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const panelId = useId();

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(DESKTOP_MEDIA_QUERY);

    function sync(matches: boolean) {
      setIsDesktopViewport(matches);
      if (matches) dispatch({ type: "viewport-desktop" });
    }

    sync(query.matches);
    function handleChange(event: MediaQueryListEvent) {
      sync(event.matches);
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  // Background scroll lock only matters while acting as a mobile overlay;
  // on desktop the panel is a static sidebar and must never lock scroll.
  useEffect(() => {
    if (!isOpen || isDesktopViewport) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, isDesktopViewport]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dispatch({ type: "escape" });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Restores focus to the trigger button whenever the drawer transitions
  // from open to closed, so keyboard/screen-reader users land back where
  // they started instead of losing their place.
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const open = useCallback(() => dispatch({ type: "open" }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  const selectConversation = useCallback(() => dispatch({ type: "select-conversation" }), []);
  const startNewChat = useCallback(() => dispatch({ type: "new-chat" }), []);
  const dismissBackdrop = useCallback(() => dispatch({ type: "backdrop-click" }), []);

  return {
    isOpen,
    isDesktopViewport,
    triggerRef,
    panelId,
    open,
    close,
    selectConversation,
    startNewChat,
    dismissBackdrop,
  };
}

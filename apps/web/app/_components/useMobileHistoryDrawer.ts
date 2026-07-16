"use client";

import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { mobileHistoryDrawerReducer } from "../_lib/mobileHistoryDrawer";
import {
  focusMobileDrawer,
  isolateMobileDrawerBackground,
  restoreMobileDrawerTriggerFocus,
  shouldRedirectFocusToDrawer,
} from "../_lib/mobileDrawerAccessibility";

// Must match the max-width breakpoint in globals.css that turns the history
// panel from a static sidebar into an off-canvas drawer.
const DESKTOP_MEDIA_QUERY = "(min-width: 721px)";

export function useMobileHistoryDrawer() {
  const [isOpen, dispatch] = useReducer(mobileHistoryDrawerReducer, false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLElement>(null);
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
    if (!isOpen || isDesktopViewport) return;
    return isolateMobileDrawerBackground(backgroundRef.current);
  }, [isOpen, isDesktopViewport]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dispatch({ type: "escape" });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || isDesktopViewport) return;
    function handleFocusIn(event: FocusEvent) {
      if (shouldRedirectFocusToDrawer(panelRef.current, event.target)) {
        focusMobileDrawer(closeButtonRef.current, panelRef.current);
      }
    }
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, [isOpen, isDesktopViewport]);

  // Moves focus into the opened mobile drawer, then restores focus to the
  // trigger button whenever the drawer closes.
  useEffect(() => {
    if (isOpen && !isDesktopViewport) {
      focusMobileDrawer(closeButtonRef.current, panelRef.current);
    } else if (wasOpenRef.current && !isOpen) {
      restoreMobileDrawerTriggerFocus(triggerRef.current);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, isDesktopViewport]);

  const open = useCallback(() => dispatch({ type: "open" }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  const toggle = useCallback(() => dispatch({ type: "toggle" }), []);
  const selectConversation = useCallback(() => dispatch({ type: "select-conversation" }), []);
  const startNewChat = useCallback(() => dispatch({ type: "new-chat" }), []);
  const dismissBackdrop = useCallback(() => dispatch({ type: "backdrop-click" }), []);

  return {
    isOpen,
    isDesktopViewport,
    triggerRef,
    closeButtonRef,
    panelRef,
    backgroundRef,
    panelId,
    open,
    close,
    toggle,
    selectConversation,
    startNewChat,
    dismissBackdrop,
  };
}

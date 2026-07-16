"use client";

import { ChatHistorySidebar } from "./ChatHistorySidebar";
import type { ChatHistorySidebarProps } from "./ChatHistorySidebar";
import { useTranslations } from "../_i18n/LocaleContext";

export interface ChatHistoryDrawerPanelProps extends ChatHistorySidebarProps {
  isOpen: boolean;
  isDesktopViewport: boolean;
  panelId: string;
  onClose: () => void;
  onBackdropClick: () => void;
}

// Wraps the existing ChatHistorySidebar (unmodified, so desktop selection,
// rename, delete, new chat, import, and export keep working exactly as
// before) with the chrome needed to present it as a mobile off-canvas
// drawer: a backdrop, dialog semantics, and a close button. On desktop
// (isDesktopViewport) this renders as a plain pass-through wrapper — the
// backdrop and dialog role are CSS-hidden and never applied.
export function ChatHistoryDrawerPanel({
  isOpen,
  isDesktopViewport,
  panelId,
  onClose,
  onBackdropClick,
  ...sidebarProps
}: ChatHistoryDrawerPanelProps) {
  const t = useTranslations();

  return (
    <>
      <div
        className={`chat-history-backdrop${isOpen ? " is-open" : ""}`}
        onClick={onBackdropClick}
        aria-hidden="true"
      />
      <div
        id={panelId}
        className={`chat-history-panel${isOpen ? " is-open" : ""}`}
        role={isDesktopViewport ? undefined : "dialog"}
        aria-modal={isDesktopViewport ? undefined : true}
        aria-label={isDesktopViewport ? undefined : t("history.title")}
        inert={!isDesktopViewport && !isOpen ? true : undefined}
      >
        <div className="chat-history-panel-header">
          <strong>{t("history.title")}</strong>
          <button type="button" className="chat-history-close" onClick={onClose} aria-label={t("history.closeHistory")}>
            ×
          </button>
        </div>

        <ChatHistorySidebar {...sidebarProps} />
      </div>
    </>
  );
}

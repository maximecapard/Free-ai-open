"use client";

import { useEffect, useId, useRef } from "react";
import type { TaskCategory } from "@free-ai-open/types";
import { newChatTaskOptions } from "../_lib/catalog";
import { useTranslations } from "../_i18n/LocaleContext";
import { CloseIcon } from "./icons";

export interface NewChatTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTask: (task: TaskCategory) => void;
}

// A small accessible modal asking what a new conversation will be used for,
// backed by the same TaskCategory catalog as the rest of the app (never a
// separate ad hoc list). Only asks for the task — the performance mode stays
// a global preference set once during Getting Started (see
// gettingStartedPreference.ts) and is never re-asked here.
export function NewChatTaskDialog({ isOpen, onClose, onSelectTask }: NewChatTaskDialogProps) {
  const t = useTranslations();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    firstOptionRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fo-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="fo-modal">
        <div className="fo-modal__header">
          <h2 id={titleId} className="fo-modal__title">
            {t("newChatDialog.title")}
          </h2>
          <button type="button" className="fo-modal__close" onClick={onClose} aria-label={t("common.dismiss")}>
            <CloseIcon />
          </button>
        </div>
        <p className="fo-muted" style={{ margin: "0 0 16px", fontSize: 14 }}>
          {t("newChatDialog.body")}
        </p>
        <div className="fo-modal__options" role="group" aria-label={t("newChatDialog.title")}>
          {newChatTaskOptions.map((task, index) => (
            <button
              key={task.id}
              type="button"
              ref={index === 0 ? firstOptionRef : undefined}
              className="fo-modal__option"
              onClick={() => onSelectTask(task.id)}
            >
              <strong>{t(task.labelKey)}</strong>
              <span className="fo-muted">{t(task.descriptionKey)}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

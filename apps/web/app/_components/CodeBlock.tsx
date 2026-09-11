"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "../_i18n/LocaleContext";
import { copyCodeToClipboard } from "../_lib/codeBlockCopy";
import { CheckIcon, CopyIcon } from "./icons";

const COPY_FEEDBACK_MS = 2000;

export interface CodeBlockProps {
  code: string;
  language?: string;
}

// Fenced code blocks render here instead of a bare <pre>/<code> — see
// MessageContent.tsx, which extracts the raw fence language/text and never
// renders model output through dangerouslySetInnerHTML. This component only
// ever receives plain text; it does not interpret or execute it.
export function CodeBlock({ code, language }: CodeBlockProps) {
  const t = useTranslations();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (resetTimeoutRef.current !== null) clearTimeout(resetTimeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    // navigator.clipboard is undefined in insecure/unavailable contexts;
    // copyCodeToClipboard already treats that as a plain "error" outcome.
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    const outcome = await copyCodeToClipboard(code, clipboard);
    if (!isMountedRef.current) return;

    setCopyState(outcome);
    if (resetTimeoutRef.current !== null) clearTimeout(resetTimeoutRef.current);
    resetTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) setCopyState("idle");
    }, COPY_FEEDBACK_MS);
  }, [code]);

  const copyLabel =
    copyState === "copied" ? t("common.copied") : copyState === "error" ? t("common.couldNotCopy") : t("common.copy");
  const languageLabel = language ? language : t("chat.codeBlockLabel");

  return (
    <div className="chat-code-block">
      <div className="chat-code-block__header">
        <span className="chat-code-block__language fo-technical-value">{languageLabel}</span>
        <button
          type="button"
          className="chat-code-block__copy"
          onClick={() => void handleCopy()}
          aria-label={copyLabel}
        >
          {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
          <span aria-hidden="true">{copyLabel}</span>
        </button>
      </div>
      <pre className="chat-code-block__pre">
        <code className="chat-code-block__code">{code}</code>
      </pre>
      <span className="fo-visually-hidden" role="status" aria-live="polite">
        {copyState === "idle" ? "" : copyLabel}
      </span>
    </div>
  );
}

"use client";

import { useTranslations } from "../_i18n/LocaleContext";

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ChatTranscript({ messages }: { messages: ChatMessageItem[] }) {
  const t = useTranslations();

  if (messages.length === 0) {
    return <p style={{ opacity: 0.6 }}>{t("chat.emptyTranscript")}</p>;
  }

  return (
    <div className="chat-transcript" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {messages.map((message) => (
        <div
          key={message.id}
          className="chat-message"
          style={{
            alignSelf: message.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "80%",
            padding: "10px 14px",
            borderRadius: 12,
            background: message.role === "user" ? "var(--color-bg-elevated)" : "var(--color-bg-elevated-2)",
            border: "1px solid var(--color-border)",
            whiteSpace: "pre-wrap",
          }}
        >
          {message.content || (message.role === "assistant" ? "…" : "")}
        </div>
      ))}
    </div>
  );
}

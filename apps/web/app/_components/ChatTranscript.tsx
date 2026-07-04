export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ChatTranscript({ messages }: { messages: ChatMessageItem[] }) {
  if (messages.length === 0) {
    return <p style={{ opacity: 0.6 }}>Send a message to start chatting with the local model.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {messages.map((message) => (
        <div
          key={message.id}
          style={{
            alignSelf: message.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "80%",
            padding: "10px 14px",
            borderRadius: 12,
            background: message.role === "user" ? "#1c1c22" : "#151519",
            border: "1px solid #333",
            whiteSpace: "pre-wrap",
          }}
        >
          {message.content || (message.role === "assistant" ? "…" : "")}
        </div>
      ))}
    </div>
  );
}

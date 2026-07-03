"use client";

import { useState } from "react";

export default function ChatPage() {
  const [message, setMessage] = useState("");

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>FreeAI Open Chat</h1>
      <p style={{ opacity: 0.75 }}>
        Placeholder chat UI. WebLLM runtime should be integrated in a Web Worker.
      </p>

      <section style={{ border: "1px solid #333", borderRadius: 16, padding: 16, minHeight: 320 }}>
        <p style={{ opacity: 0.6 }}>No runtime connected yet.</p>
      </section>

      <form style={{ display: "flex", gap: 12, marginTop: 16 }} onSubmit={(event) => event.preventDefault()}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask locally..."
          style={{ flex: 1, padding: 12, borderRadius: 12 }}
        />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}

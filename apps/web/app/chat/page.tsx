"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ModelStatusPill } from "../_components/ModelStatusPill";
import { PrivacyNotice } from "../_components/PrivacyNotice";
import { findModeLabel, findTaskLabel } from "../_lib/catalog";

function ChatContent() {
  const searchParams = useSearchParams();
  const taskLabel = findTaskLabel(searchParams.get("task"));
  const modeLabel = findModeLabel(searchParams.get("mode"));
  const [message, setMessage] = useState("");

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0 }}>Chat</h1>
        <ModelStatusPill taskLabel={taskLabel} modeLabel={modeLabel} />
      </div>

      <section style={{ border: "1px solid #333", borderRadius: 16, padding: 16, minHeight: 320 }}>
        <p style={{ opacity: 0.6 }}>
          No runtime connected yet. The local model will load here once the
          WebLLM runtime is wired in.
        </p>
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

      <div style={{ marginTop: 24 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatContent />
    </Suspense>
  );
}

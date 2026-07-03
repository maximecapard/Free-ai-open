import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "64px 24px" }}>
      <p style={{ opacity: 0.7 }}>Open-source local AI assistant</p>
      <h1 style={{ fontSize: 56, lineHeight: 1, margin: "16px 0" }}>FreeAI Open</h1>
      <p style={{ fontSize: 20, lineHeight: 1.5, opacity: 0.85 }}>
        Run a local AI assistant directly in your browser. Choose a task, pick a
        performance mode, and let the app recommend the best model for your device.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
        <Link href="/chat">Open chat</Link>
        <Link href="/debug">Debug dashboard</Link>
      </div>
    </main>
  );
}

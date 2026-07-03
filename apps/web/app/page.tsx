import Link from "next/link";
import { PrivacyNotice } from "./_components/PrivacyNotice";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ opacity: 0.7 }}>Open-source local AI assistant</p>
      <h1 style={{ fontSize: 56, lineHeight: 1, margin: "16px 0" }}>FreeAI Open</h1>
      <p style={{ fontSize: 20, lineHeight: 1.5, opacity: 0.85 }}>
        Pick what you want to do, choose how fast or how capable you want it to
        be, and FreeAI Open recommends a model that runs entirely on your
        device.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
        <Link
          href="/onboarding"
          style={{
            padding: "12px 20px",
            borderRadius: 12,
            background: "#f7f7f7",
            color: "#0b0b0f",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Get started
        </Link>
        <Link
          href="/chat"
          style={{ padding: "12px 20px", borderRadius: 12, border: "1px solid #333" }}
        >
          Skip to chat
        </Link>
      </div>
      <div style={{ marginTop: 40 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

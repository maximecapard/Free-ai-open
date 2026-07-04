import Link from "next/link";
import { PrivacyNotice } from "../_components/PrivacyNotice";

export default function OnboardingIntroPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 16 }}>Let&apos;s set things up</h1>
      <p style={{ fontSize: 17, lineHeight: 1.6, opacity: 0.85 }}>
        FreeAI Open runs the AI model directly in your browser — nothing you
        type is sent anywhere. In a few short steps, we&apos;ll check what
        your device can run, then ask what you want to do and how you want it
        to feel, and suggest a model that fits.
      </p>

      <Link
        href="/onboarding/device"
        style={{
          display: "inline-block",
          marginTop: 32,
          padding: "12px 20px",
          borderRadius: 12,
          background: "#f7f7f7",
          color: "#0b0b0f",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Continue
      </Link>

      <div style={{ marginTop: 40 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

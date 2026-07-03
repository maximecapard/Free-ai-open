"use client";

export default function DebugPage() {
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>Debug dashboard</h1>
      <p style={{ opacity: 0.75 }}>
        This page will show device profile, selected model, router decisions,
        performance metrics, local logs, and last redacted telemetry events.
      </p>
    </main>
  );
}

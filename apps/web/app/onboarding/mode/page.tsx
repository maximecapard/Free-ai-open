import Link from "next/link";
import { findTaskLabel, performanceModes } from "../../_lib/catalog";

interface OnboardingModePageProps {
  searchParams: Promise<{ task?: string }>;
}

export default async function OnboardingModePage({ searchParams }: OnboardingModePageProps) {
  const { task } = await searchParams;
  const taskLabel = findTaskLabel(task);

  if (!task || !taskLabel) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <p>Please choose a task first.</p>
        <Link href="/onboarding/task">Back to task selection</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ opacity: 0.6, fontSize: 14 }}>Step 3 of 3 · {taskLabel}</p>
      <h1 style={{ fontSize: 28, margin: "8px 0 24px" }}>How should it feel?</h1>

      <div style={{ display: "grid", gap: 12 }}>
        {performanceModes.map((mode) => (
          <Link
            key={mode.id}
            href={`/chat?task=${task}&mode=${mode.id}`}
            style={{
              display: "block",
              padding: 16,
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <strong>{mode.label}</strong>
            <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.7 }}>{mode.description}</p>
          </Link>
        ))}
      </div>

      <p style={{ marginTop: 24, fontSize: 13, opacity: 0.6 }}>
        You can change this later. Manual model selection will also be
        available for advanced users.
      </p>
    </main>
  );
}

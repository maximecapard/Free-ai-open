import Link from "next/link";
import { taskCategories } from "../../_lib/catalog";

export default function OnboardingTaskPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ opacity: 0.6, fontSize: 14 }}>Step 2 of 3</p>
      <h1 style={{ fontSize: 28, margin: "8px 0 24px" }}>What do you want to do?</h1>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, 1fr)" }}>
        {taskCategories.map((task) => (
          <Link
            key={task.id}
            href={`/onboarding/mode?task=${task.id}`}
            style={{
              display: "block",
              padding: 16,
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <strong>{task.label}</strong>
            <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.7 }}>{task.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}

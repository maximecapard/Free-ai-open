"use client";

import Link from "next/link";
import { taskCategories } from "../../_lib/catalog";
import { useTranslations } from "../../_i18n/LocaleContext";

export default function OnboardingTaskPage() {
  const t = useTranslations();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ opacity: 0.6, fontSize: 14 }}>{t("onboarding.step2")}</p>
      <h1 style={{ fontSize: 28, margin: "8px 0 24px" }}>{t("onboarding.taskTitle")}</h1>

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
            <strong>{t(task.labelKey)}</strong>
            <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.7 }}>{t(task.descriptionKey)}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}

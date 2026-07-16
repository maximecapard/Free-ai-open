"use client";

import Link from "next/link";
import { taskCategories } from "../../_lib/catalog";
import { useTranslations } from "../../_i18n/LocaleContext";

export default function OnboardingTaskPage() {
  const t = useTranslations();

  return (
    <main className="fo-container-narrow" style={{ padding: "48px 0" }}>
      <p className="fo-technical-label">{t("onboarding.step2")}</p>
      <h1 className="fo-page-title" style={{ marginTop: 8 }}>
        {t("onboarding.taskTitle")}
      </h1>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {taskCategories.map((task) => (
          <Link key={task.id} href={`/onboarding/mode?task=${task.id}`} className="fo-card" style={{ padding: 16, textDecoration: "none", color: "inherit" }}>
            <strong>{t(task.labelKey)}</strong>
            <p className="fo-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              {t(task.descriptionKey)}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}

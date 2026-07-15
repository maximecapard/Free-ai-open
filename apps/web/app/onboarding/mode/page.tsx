"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { findTaskLabelKey, performanceModes } from "../../_lib/catalog";
import { useTranslations } from "../../_i18n/LocaleContext";

function OnboardingModeContent() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const task = searchParams.get("task") ?? undefined;
  const taskLabelKey = findTaskLabelKey(task);
  const taskLabel = taskLabelKey ? t(taskLabelKey) : null;

  if (!task || !taskLabel) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <p>{t("onboarding.chooseTaskFirst")}</p>
        <Link href="/onboarding/task">{t("onboarding.backToTaskSelection")}</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ opacity: 0.6, fontSize: 14 }}>{t("onboarding.step3WithTask", { task: taskLabel })}</p>
      <h1 style={{ fontSize: 28, margin: "8px 0 24px" }}>{t("onboarding.modeTitle")}</h1>

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
            <strong>{t(mode.labelKey)}</strong>
            <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.7 }}>{t(mode.descriptionKey)}</p>
          </Link>
        ))}
      </div>

      <p style={{ marginTop: 24, fontSize: 13, opacity: 0.6 }}>{t("onboarding.modeFooter")}</p>
    </main>
  );
}

export default function OnboardingModePage() {
  return (
    <Suspense fallback={null}>
      <OnboardingModeContent />
    </Suspense>
  );
}

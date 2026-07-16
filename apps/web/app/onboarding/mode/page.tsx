"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import { findTaskLabelKey, performanceModes } from "../../_lib/catalog";
import { recommendPerformanceMode } from "../../_lib/deviceRecommendation";
import { useTranslations } from "../../_i18n/LocaleContext";

function OnboardingModeContent() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const task = searchParams.get("task") ?? undefined;
  const taskLabelKey = findTaskLabelKey(task);
  const taskLabel = taskLabelKey ? t(taskLabelKey) : null;
  const [recommendedModeId, setRecommendedModeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectDeviceProfile().then((profile) => {
      if (!cancelled) setRecommendedModeId(recommendPerformanceMode(profile.deviceTier));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!task || !taskLabel) {
    return (
      <main className="fo-container-narrow" style={{ padding: "48px 0" }}>
        <p>{t("onboarding.chooseTaskFirst")}</p>
        <Link href="/onboarding/task">{t("onboarding.backToTaskSelection")}</Link>
      </main>
    );
  }

  return (
    <main className="fo-container-narrow" style={{ padding: "48px 0" }}>
      <p className="fo-technical-label">{t("onboarding.step3WithTask", { task: taskLabel })}</p>
      <h1 className="fo-page-title" style={{ marginTop: 8 }}>
        {t("onboarding.modeTitle")}
      </h1>

      <div style={{ display: "grid", gap: 12 }}>
        {performanceModes.map((mode) => {
          const isRecommended = mode.id === recommendedModeId;
          return (
            <Link
              key={mode.id}
              href={`/chat?task=${task}&mode=${mode.id}`}
              className="fo-card"
              style={{
                padding: 16,
                textDecoration: "none",
                color: "inherit",
                borderColor: isRecommended ? "var(--fo-accent)" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{t(mode.labelKey)}</strong>
                {isRecommended && (
                  <span className="fo-badge" style={{ borderColor: "var(--fo-accent)", color: "var(--fo-accent-strong)" }}>
                    {t("modes.recommendedBadge")}
                  </span>
                )}
              </div>
              <p className="fo-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                {t(mode.descriptionKey)}
              </p>
            </Link>
          );
        })}
      </div>

      <p className="fo-muted" style={{ marginTop: 24, fontSize: 13 }}>
        {t("onboarding.modeFooter")}
      </p>
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

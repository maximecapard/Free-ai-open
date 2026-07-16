"use client";

import type { GenerationMetrics } from "../_lib/debugDiagnostics";
import { DebugField, DebugSection } from "./DebugSection";
import { useTranslations } from "../_i18n/LocaleContext";

export function DebugPerformanceSection({
  loadTimeMs,
  generationMetrics,
  isGenerating,
}: {
  loadTimeMs: number | undefined;
  generationMetrics: GenerationMetrics | null;
  isGenerating: boolean;
}) {
  const t = useTranslations();

  return (
    <DebugSection title={t("debug.performance")}>
      <DebugField
        label={t("debug.modelLoadTime")}
        value={loadTimeMs !== undefined ? `${loadTimeMs} ms` : t("debug.notRecordedYet")}
        technical={loadTimeMs !== undefined}
      />
      <DebugField
        label={t("debug.firstToken")}
        value={
          generationMetrics?.firstTokenMs !== undefined && generationMetrics.firstTokenMs !== null
            ? `${generationMetrics.firstTokenMs} ms`
            : t("debug.notRecordedYet")
        }
        technical={generationMetrics?.firstTokenMs !== undefined && generationMetrics.firstTokenMs !== null}
      />
      <DebugField
        label={t("debug.tokensPerSecond")}
        value={generationMetrics?.tokensPerSecond !== undefined ? generationMetrics.tokensPerSecond : t("debug.notRecordedYet")}
        technical={generationMetrics?.tokensPerSecond !== undefined}
      />
      <DebugField label={t("debug.generationInProgress")} value={isGenerating ? t("debug.yes") : t("debug.no")} />
    </DebugSection>
  );
}

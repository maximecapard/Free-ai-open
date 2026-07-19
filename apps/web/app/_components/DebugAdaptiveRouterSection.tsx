"use client";

import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { RouterDecision } from "@free-ai-open/model-router";
import type { TranslationKey } from "../_i18n/dictionary";
import { adaptiveReasonKey, adaptiveRejectionKey, adaptiveWarningKey } from "../_lib/adaptiveRouteExplanation";
import type { ModelSelectionMode } from "../_lib/manualModelPreference";
import type { ObservationsSummary } from "../_lib/observationsSummary";
import { localizedModelName } from "../_lib/modelDisplayName";
import { DebugField, DebugSection } from "./DebugSection";
import { useTranslations } from "../_i18n/LocaleContext";

const CONFIDENCE_KEYS: Record<RouterDecision["confidence"], TranslationKey> = {
  low: "benchmark.confidenceValue.low",
  medium: "benchmark.confidenceValue.medium",
  high: "benchmark.confidenceValue.high",
};

function displayNameFor(
  registry: readonly ModelRegistryRecord[],
  modelId: string,
  t: ReturnType<typeof useTranslations>
): string {
  const record = registry.find((item) => item.id === modelId);
  return record ? localizedModelName(record, t) : modelId;
}

function withCacheLabel(name: string, modelId: string, cachedModelIds: ReadonlySet<string>, t: (key: TranslationKey) => string): string {
  return `${name} (${cachedModelIds.has(modelId) ? t("debug.adaptiveCached") : t("debug.adaptiveNotCached")})`;
}

export function DebugAdaptiveRouterSection({
  decision,
  registry,
  modelSelectionMode,
  cachedModelIds,
}: {
  decision: RouterDecision | null;
  registry: readonly ModelRegistryRecord[];
  modelSelectionMode: ModelSelectionMode;
  cachedModelIds: ReadonlySet<string>;
}) {
  const t = useTranslations();

  return (
    <DebugSection title={t("debug.adaptiveRouterTitle")}>
      {!decision ? (
        <p className="fo-muted" style={{ fontSize: 14 }}>
          {t("debug.adaptiveRouterNotEvaluated")}
        </p>
      ) : (
        <>
          <DebugField
            label={t("debug.adaptiveSelectedModel")}
            value={
              decision.selectedModelId
                ? withCacheLabel(displayNameFor(registry, decision.selectedModelId, t), decision.selectedModelId, cachedModelIds, t)
                : t("debug.adaptiveNoSelection")
            }
          />
          <DebugField
            label={t("debug.adaptiveMode")}
            value={t(modelSelectionMode === "manual" ? "debug.adaptiveModeManual" : "debug.adaptiveModeAutomatic")}
          />
          <DebugField label={t("debug.adaptiveConfidence")} value={t(CONFIDENCE_KEYS[decision.confidence])} />

          <div style={{ marginTop: 12 }}>
            <DebugField
              label={t("debug.adaptiveReasonsLabel")}
              value={decision.reasons.length > 0 ? decision.reasons.map((reason) => t(adaptiveReasonKey(reason))).join(", ") : t("debug.adaptiveNoSelection")}
            />
            {decision.warnings.length > 0 && (
              <DebugField
                label={t("debug.adaptiveWarningsLabel")}
                value={decision.warnings.map((warning) => t(adaptiveWarningKey(warning))).join(", ")}
              />
            )}
            <DebugField
              label={t("debug.adaptiveFallbackChain")}
              value={
                decision.fallbackModelIds.length > 0
                  ? decision.fallbackModelIds
                      .map((modelId) => withCacheLabel(displayNameFor(registry, modelId, t), modelId, cachedModelIds, t))
                      .join(" → ")
                  : t("debug.adaptiveNoFallback")
              }
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <DebugField label={t("debug.adaptiveRecommendedContext")} value={`${decision.recommendedContextTokens}`} technical />
            <DebugField label={t("debug.adaptiveRecommendedOutput")} value={`${decision.recommendedMaxOutputTokens}`} technical />
            <DebugField label={t("debug.adaptiveDecisionVersion")} value={decision.decisionVersion} technical />
            <DebugField label={t("debug.adaptiveRegistryVersion")} value={decision.registryVersion} technical />
          </div>

          {decision.rejectedModels.length > 0 && (
            <details className="fo-muted" style={{ marginTop: 12, fontSize: 13 }}>
              <summary style={{ cursor: "pointer" }}>{t("debug.adaptiveRejectedModels", { count: decision.rejectedModels.length })}</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                {decision.rejectedModels.map((rejected) => (
                  <li key={rejected.modelId}>
                    <span className="fo-technical-value">{rejected.modelId}</span> —{" "}
                    {rejected.reasons.map((reason) => t(adaptiveRejectionKey(reason))).join(", ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </DebugSection>
  );
}

const OUTCOME_KEYS: Array<{ key: keyof ObservationsSummary["byOutcome"]; label: TranslationKey }> = [
  { key: "completed", label: "debug.observationOutcome.completed" },
  { key: "cancelled", label: "debug.observationOutcome.cancelled" },
  { key: "stalled", label: "debug.observationOutcome.stalled" },
  { key: "degenerate", label: "debug.observationOutcome.degenerate" },
  { key: "out_of_memory", label: "debug.observationOutcome.out_of_memory" },
  { key: "device_lost", label: "debug.observationOutcome.device_lost" },
  { key: "load_failed", label: "debug.observationOutcome.load_failed" },
];

export function DebugObservationsSection({
  summary,
  registry,
}: {
  summary: ObservationsSummary;
  registry: readonly ModelRegistryRecord[];
}) {
  const t = useTranslations();
  const modelEntries = Object.entries(summary.byModel);

  return (
    <DebugSection title={t("debug.observationsTitle")}>
      {summary.total === 0 ? (
        <p className="fo-muted" style={{ fontSize: 14 }}>
          {t("debug.observationsNone")}
        </p>
      ) : (
        <>
          <DebugField label={t("debug.observationsTotal")} value={`${summary.total}`} technical />

          <div style={{ marginTop: 12 }}>
            <p className="fo-muted" style={{ margin: "0 0 4px", fontSize: 13 }}>
              {t("debug.observationsByOutcome")}
            </p>
            {OUTCOME_KEYS.filter(({ key }) => summary.byOutcome[key] > 0).map(({ key, label }) => (
              <DebugField key={key} label={t(label)} value={`${summary.byOutcome[key]}`} technical />
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <p className="fo-muted" style={{ margin: "0 0 4px", fontSize: 13 }}>
              {t("debug.observationsByModel")}
            </p>
            {modelEntries.map(([modelId, count]) => (
              <DebugField key={modelId} label={displayNameFor(registry, modelId, t)} value={`${count}`} technical />
            ))}
          </div>
        </>
      )}
    </DebugSection>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { modelRegistryV2, sampleModels } from "@free-ai-open/model-registry";
import { routeAdaptiveModel, selectRecommendedModel } from "@free-ai-open/model-router";
import type { ModelRouterResult, RouterDecision } from "@free-ai-open/model-router";
import { clearLocalLogs, getRecentLocalLogs } from "@free-ai-open/local-logs";
import type { LocalLogRecord } from "@free-ai-open/local-logs";
import { buildDiagnosticReport, copyDiagnosticReportToClipboardData, exportDiagnosticReportAsJson } from "@free-ai-open/diagnostic-report";
import type { DiagnosticReport } from "@free-ai-open/diagnostic-report";
import type { PerformanceMode } from "@free-ai-open/types";
import { getStoredLocalBenchmarkResult } from "../_lib/benchmarkResultStore";
import { recommendPerformanceMode } from "../_lib/deviceRecommendation";
import { detectAndStoreDeviceProfile } from "../_lib/deviceProfileDetection";
import {
  findGenerationMetrics,
  findLastRuntimeStatus,
  findLoadTimeMs,
  findLoadedModelId,
} from "../_lib/debugDiagnostics";
import { buildDebugDiagnosticReportInput, DEBUG_PREVIEW_TASK } from "../_lib/debugReportInput";
import { getStoredManualModelPreference } from "../_lib/manualModelPreference";
import type { ModelSelectionMode } from "../_lib/manualModelPreference";
import { getStoredModelPerformanceObservations } from "../_lib/modelObservationStore";
import { summarizeStoredObservations } from "../_lib/observationsSummary";
import type { ObservationsSummary } from "../_lib/observationsSummary";
import { DebugSystemStatus } from "../_components/DebugSystemStatus";
import { DebugModelSection } from "../_components/DebugModelSection";
import { DebugAdaptiveRouterSection, DebugObservationsSection } from "../_components/DebugAdaptiveRouterSection";
import { DebugPerformanceSection } from "../_components/DebugPerformanceSection";
import { DebugRecentLogs } from "../_components/DebugRecentLogs";
import { DebugPrivacySection } from "../_components/DebugPrivacySection";
import { DebugActions } from "../_components/DebugActions";
import { useLocale, useTranslations } from "../_i18n/LocaleContext";
import { buildRouterInputContext } from "../_runtime/routingOrchestration";

const EMPTY_OBSERVATIONS_SUMMARY: ObservationsSummary = {
  total: 0,
  byOutcome: { completed: 0, cancelled: 0, stalled: 0, degenerate: 0, out_of_memory: 0, device_lost: 0, load_failed: 0 },
  byModel: {},
};

const MAX_LOGS = 25;

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function buildReportInput(deviceProfile: DeviceProfile | null, routeResult: ModelRouterResult | null, mode: PerformanceMode, logs: LocalLogRecord[]) {
  return buildDebugDiagnosticReportInput({
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
    deviceProfile,
    routeResult,
    mode,
    logs,
    localBenchmark: getStoredLocalBenchmarkResult(),
  });
}

export default function DebugPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [routeResult, setRouteResult] = useState<ModelRouterResult | null>(null);
  const [adaptiveDecision, setAdaptiveDecision] = useState<RouterDecision | null>(null);
  const [cachedModelIds, setCachedModelIds] = useState<ReadonlySet<string>>(new Set());
  const [modelSelectionMode, setModelSelectionMode] = useState<ModelSelectionMode>("automatic");
  const [observationsSummary, setObservationsSummary] = useState<ObservationsSummary>(EMPTY_OBSERVATIONS_SUMMARY);
  const [mode, setMode] = useState<PerformanceMode>("balanced");
  const [logs, setLogs] = useState<LocalLogRecord[]>([]);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Starts true (matching the server-rendered markup) and is corrected once
  // the effect below runs client-side, to avoid a hydration mismatch from
  // branching on a browser-only API (indexedDB) during the initial render.
  const [logsAvailable, setLogsAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const available = isIndexedDbAvailable();
    setLogsAvailable(available);

    const profile = await detectAndStoreDeviceProfile();
    const previewMode = recommendPerformanceMode(profile.deviceTier);
    const result = selectRecommendedModel({
      task: DEBUG_PREVIEW_TASK,
      performanceMode: previewMode,
      deviceProfile: profile,
      modelRegistry: sampleModels,
    });
    const recentLogs = available ? await getRecentLocalLogs(MAX_LOGS) : [];

    const manualPreference = getStoredManualModelPreference();
    setModelSelectionMode(manualPreference.mode);

    const routerInput = await buildRouterInputContext({
      task: DEBUG_PREVIEW_TASK,
      locale,
      performanceMode: previewMode,
      manualModelId: manualPreference.mode === "manual" ? (manualPreference.manualModelId ?? undefined) : undefined,
    });
    setAdaptiveDecision(routerInput ? routeAdaptiveModel(routerInput) : null);
    setCachedModelIds(new Set(routerInput?.cachedModelIds ?? []));
    setObservationsSummary(summarizeStoredObservations(getStoredModelPerformanceObservations()));

    setDeviceProfile(profile);
    setRouteResult(result);
    setMode(previewMode);
    setLogs(recentLogs);
    setReport(buildDiagnosticReport(buildReportInput(profile, result, previewMode, recentLogs)));
  }, [locale]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCopy() {
    try {
      const data = copyDiagnosticReportToClipboardData(buildReportInput(deviceProfile, routeResult, mode, logs));
      await navigator.clipboard.writeText(data["text/plain"]);
      setStatusMessage(t("debug.copiedToClipboard"));
    } catch {
      setStatusMessage(t("debug.clipboardUnavailable"));
    }
  }

  function handleDownload() {
    try {
      const json = exportDiagnosticReportAsJson(buildReportInput(deviceProfile, routeResult, mode, logs));
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `freeai-open-diagnostic-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatusMessage(t("debug.reportDownloaded"));
    } catch {
      setStatusMessage(t("debug.reportBuildFailed"));
    }
  }

  async function handleClear() {
    if (!logsAvailable) {
      setStatusMessage(t("debug.noLogsToClear"));
      return;
    }
    if (!window.confirm(t("debug.clearLogsConfirm"))) return;
    await clearLocalLogs();
    setStatusMessage(t("debug.logsCleared"));
    await refresh();
  }

  const loadedModelId = findLoadedModelId(logs);
  const loadedModel = loadedModelId ? sampleModels.find((model) => model.id === loadedModelId) ?? null : null;
  const lastRuntimeStatus = findLastRuntimeStatus(logs);

  return (
    <main className="fo-ink-surface" style={{ maxWidth: 760, margin: "24px auto", padding: 24 }}>
      <p className="fo-technical-label" style={{ margin: 0 }}>
        {t("debug.title")}
      </p>
      <p className="fo-muted" style={{ fontSize: 14, marginTop: 4, marginBottom: 20 }}>
        {t("debug.subtitle")}
      </p>

      <DebugActions onRefresh={refresh} onCopy={handleCopy} onDownload={handleDownload} onClear={handleClear} statusMessage={statusMessage} />

      {!logsAvailable && (
        <section className="fo-inline-notice" style={{ borderColor: "var(--fo-warning)", background: "var(--fo-warning-soft)", marginBottom: 16 }}>
          <strong>{t("debug.storageUnavailableTitle")}</strong>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>{t("debug.storageUnavailableBody")}</p>
        </section>
      )}

      <DebugSystemStatus deviceProfile={deviceProfile} performanceMode={mode} lastRuntimeStatus={lastRuntimeStatus} />

      <DebugModelSection
        recommendedModel={routeResult?.selectedModel ?? null}
        loadedModelId={loadedModelId}
        loadedModel={loadedModel}
      />

      <DebugAdaptiveRouterSection
        decision={adaptiveDecision}
        registry={modelRegistryV2}
        modelSelectionMode={modelSelectionMode}
        cachedModelIds={cachedModelIds}
      />

      <DebugObservationsSection summary={observationsSummary} registry={modelRegistryV2} />

      <DebugPerformanceSection
        loadTimeMs={findLoadTimeMs(logs)}
        generationMetrics={findGenerationMetrics(logs)}
        isGenerating={
          lastRuntimeStatus?.status === "generating" ||
          lastRuntimeStatus?.status === "cancelling" ||
          lastRuntimeStatus?.status === "recovering"
        }
      />

      <DebugRecentLogs logs={logs} logsAvailable={logsAvailable} />

      <DebugPrivacySection contentLogged={report?.contentLogged ?? null} />
    </main>
  );
}

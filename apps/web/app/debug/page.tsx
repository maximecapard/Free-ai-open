"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RuntimeState } from "@free-ai-open/ai-runtime";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import { clearLocalLogs, getRecentLocalLogs } from "@free-ai-open/local-logs";
import type { LocalLogRecord } from "@free-ai-open/local-logs";
import { buildDiagnosticReport, copyDiagnosticReportToClipboardData, exportDiagnosticReportAsJson } from "@free-ai-open/diagnostic-report";
import type { DiagnosticReport } from "@free-ai-open/diagnostic-report";
import type { PerformanceMode, TaskCategory } from "@free-ai-open/types";
import { getStoredLocalBenchmarkResult } from "../_lib/benchmarkResultStore";
import { recommendPerformanceMode } from "../_lib/deviceRecommendation";
import { detectAndStoreDeviceProfile } from "../_lib/deviceProfileDetection";
import {
  findGenerationMetrics,
  findLoadTimeMs,
} from "../_lib/debugDiagnostics";
import { buildDebugDiagnosticReportInput } from "../_lib/debugReportInput";
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
import { useAppRuntime } from "../_runtime/AppRuntimeProvider";

const EMPTY_OBSERVATIONS_SUMMARY: ObservationsSummary = {
  total: 0,
  byOutcome: { completed: 0, cancelled: 0, stalled: 0, degenerate: 0, out_of_memory: 0, device_lost: 0, load_failed: 0 },
  byModel: {},
};

const MAX_LOGS = 25;

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

interface RuntimeDiagnosticSnapshot {
  runtimeStatus: RuntimeState["status"];
  mode: PerformanceMode | null;
  task: TaskCategory;
  recommendedModelId?: string;
  loadedModelId?: string;
}

function buildReportInput(deviceProfile: DeviceProfile | null, snapshot: RuntimeDiagnosticSnapshot, logs: LocalLogRecord[]) {
  return buildDebugDiagnosticReportInput({
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
    deviceProfile,
    routeResult: null,
    mode: snapshot.mode,
    runtimeStatus: snapshot.runtimeStatus,
    task: snapshot.task,
    recommendedModelId: snapshot.recommendedModelId,
    loadedModelId: snapshot.loadedModelId,
    logs,
    localBenchmark: getStoredLocalBenchmarkResult(),
  });
}

export default function DebugPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const {
    runtimeState,
    performanceMode,
    activeConversationTask,
    routerDecision,
    selectedModel,
    loadedModel,
    modelSelectionMode,
    manualModelId,
  } = useAppRuntime();
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [cachedModelIds, setCachedModelIds] = useState<ReadonlySet<string>>(new Set());
  const [observationsSummary, setObservationsSummary] = useState<ObservationsSummary>(EMPTY_OBSERVATIONS_SUMMARY);
  const [logs, setLogs] = useState<LocalLogRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Starts true (matching the server-rendered markup) and is corrected once
  // the effect below runs client-side, to avoid a hydration mismatch from
  // branching on a browser-only API (indexedDB) during the initial render.
  const [logsAvailable, setLogsAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const available = isIndexedDbAvailable();
    setLogsAvailable(available);

    const profile = await detectAndStoreDeviceProfile();
    const effectiveMode = performanceMode ?? recommendPerformanceMode(profile.deviceTier);
    const recentLogs = available ? await getRecentLocalLogs(MAX_LOGS) : [];

    const routerInput = await buildRouterInputContext({
      task: activeConversationTask,
      locale,
      performanceMode: effectiveMode,
      manualModelId: modelSelectionMode === "manual" ? (manualModelId ?? undefined) : undefined,
    });
    setCachedModelIds(new Set(routerInput?.cachedModelIds ?? []));
    setObservationsSummary(summarizeStoredObservations(getStoredModelPerformanceObservations()));

    setDeviceProfile(profile);
    setLogs(recentLogs);
  }, [
    activeConversationTask,
    loadedModel?.id,
    locale,
    manualModelId,
    modelSelectionMode,
    performanceMode,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCopy() {
    try {
      const data = copyDiagnosticReportToClipboardData(
        buildReportInput(
          deviceProfile,
          {
            runtimeStatus: runtimeState.status,
            mode: performanceMode,
            task: activeConversationTask,
            recommendedModelId: selectedModel?.id,
            loadedModelId: loadedModel?.id,
          },
          logs
        )
      );
      await navigator.clipboard.writeText(data["text/plain"]);
      setStatusMessage(t("debug.copiedToClipboard"));
    } catch {
      setStatusMessage(t("debug.clipboardUnavailable"));
    }
  }

  function handleDownload() {
    try {
      const json = exportDiagnosticReportAsJson(
        buildReportInput(
          deviceProfile,
          {
            runtimeStatus: runtimeState.status,
            mode: performanceMode,
            task: activeConversationTask,
            recommendedModelId: selectedModel?.id,
            loadedModelId: loadedModel?.id,
          },
          logs
        )
      );
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

  const loadedModelId = loadedModel?.id ?? null;
  const report = useMemo<DiagnosticReport>(
    () =>
      buildDiagnosticReport(
        buildReportInput(
          deviceProfile,
          {
            runtimeStatus: runtimeState.status,
            mode: performanceMode,
            task: activeConversationTask,
            recommendedModelId: selectedModel?.id,
            loadedModelId: loadedModel?.id,
          },
          logs
        )
      ),
    [activeConversationTask, deviceProfile, loadedModel?.id, logs, performanceMode, runtimeState.status, selectedModel?.id]
  );

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

      <DebugSystemStatus
        deviceProfile={deviceProfile}
        performanceMode={performanceMode}
        runtimeStatus={runtimeState.status}
      />

      <DebugModelSection
        recommendedModel={selectedModel}
        loadedModelId={loadedModelId}
        loadedModel={loadedModel}
      />

      <DebugAdaptiveRouterSection
        decision={routerDecision}
        registry={modelRegistryV2}
        modelSelectionMode={modelSelectionMode}
        cachedModelIds={cachedModelIds}
      />

      <DebugObservationsSection summary={observationsSummary} registry={modelRegistryV2} />

      <DebugPerformanceSection
        loadTimeMs={findLoadTimeMs(logs)}
        generationMetrics={findGenerationMetrics(logs)}
        isGenerating={
          runtimeState.status === "generating" ||
          runtimeState.status === "cancelling" ||
          runtimeState.status === "recovering"
        }
      />

      <DebugRecentLogs logs={logs} logsAvailable={logsAvailable} />

      <DebugPrivacySection contentLogged={report.contentLogged} />
    </main>
  );
}

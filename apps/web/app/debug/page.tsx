"use client";

import { useCallback, useEffect, useState } from "react";
import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { sampleModels } from "@free-ai-open/model-registry";
import { selectRecommendedModel } from "@free-ai-open/model-router";
import type { ModelRouterResult } from "@free-ai-open/model-router";
import { clearLocalLogs, getRecentLocalLogs } from "@free-ai-open/local-logs";
import type { LocalLogRecord } from "@free-ai-open/local-logs";
import { buildDiagnosticReport, copyDiagnosticReportToClipboardData, exportDiagnosticReportAsJson } from "@free-ai-open/diagnostic-report";
import type { DiagnosticReport } from "@free-ai-open/diagnostic-report";
import type { PerformanceMode } from "@free-ai-open/types";
import { recommendPerformanceMode } from "../_lib/deviceRecommendation";
import {
  findGenerationMetrics,
  findLastRuntimeStatus,
  findLoadTimeMs,
  findLoadedModelId,
} from "../_lib/debugDiagnostics";
import { buildDebugDiagnosticReportInput, DEBUG_PREVIEW_TASK } from "../_lib/debugReportInput";
import { DebugSystemStatus } from "../_components/DebugSystemStatus";
import { DebugModelSection } from "../_components/DebugModelSection";
import { DebugPerformanceSection } from "../_components/DebugPerformanceSection";
import { DebugRecentLogs } from "../_components/DebugRecentLogs";
import { DebugPrivacySection } from "../_components/DebugPrivacySection";
import { DebugActions } from "../_components/DebugActions";

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
  });
}

export default function DebugPage() {
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [routeResult, setRouteResult] = useState<ModelRouterResult | null>(null);
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

    const profile = await detectDeviceProfile();
    const previewMode = recommendPerformanceMode(profile.deviceTier);
    const result = selectRecommendedModel({
      task: DEBUG_PREVIEW_TASK,
      performanceMode: previewMode,
      deviceProfile: profile,
      modelRegistry: sampleModels,
    });
    const recentLogs = available ? await getRecentLocalLogs(MAX_LOGS) : [];

    setDeviceProfile(profile);
    setRouteResult(result);
    setMode(previewMode);
    setLogs(recentLogs);
    setReport(buildDiagnosticReport(buildReportInput(profile, result, previewMode, recentLogs)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCopy() {
    try {
      const data = copyDiagnosticReportToClipboardData(buildReportInput(deviceProfile, routeResult, mode, logs));
      await navigator.clipboard.writeText(data["text/plain"]);
      setStatusMessage("Diagnostic report copied to clipboard.");
    } catch {
      setStatusMessage("Couldn't access the clipboard in this browser.");
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
      setStatusMessage("Diagnostic report downloaded.");
    } catch {
      setStatusMessage("Couldn't build the diagnostic report.");
    }
  }

  async function handleClear() {
    if (!logsAvailable) {
      setStatusMessage("No local logs to clear — IndexedDB isn't available in this browser.");
      return;
    }
    if (!window.confirm("Clear all local technical logs from this browser?")) return;
    await clearLocalLogs();
    setStatusMessage("Local logs cleared.");
    await refresh();
  }

  const loadedModelId = findLoadedModelId(logs);
  const loadedModel = loadedModelId ? sampleModels.find((model) => model.id === loadedModelId) ?? null : null;
  const lastRuntimeStatus = findLastRuntimeStatus(logs);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Debug dashboard</h1>
      <p style={{ fontSize: 14, opacity: 0.65, marginBottom: 20 }}>
        Local, technical diagnostics for this browser. Nothing here is sent to a server.
      </p>

      <DebugActions onRefresh={refresh} onCopy={handleCopy} onDownload={handleDownload} onClear={handleClear} statusMessage={statusMessage} />

      {!logsAvailable && (
        <section
          style={{
            border: "1px solid #e5a53e",
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            background: "rgba(229, 165, 62, 0.08)",
          }}
        >
          <strong>Local storage unavailable</strong>
          <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.9 }}>
            This browser doesn&apos;t expose IndexedDB, so technical logs can&apos;t be recorded or displayed here. Everything
            else on this page still works from live device checks.
          </p>
        </section>
      )}

      <DebugSystemStatus deviceProfile={deviceProfile} performanceMode={mode} lastRuntimeStatus={lastRuntimeStatus} />

      <DebugModelSection
        recommendedModel={routeResult?.selectedModel ?? null}
        loadedModelId={loadedModelId}
        loadedModel={loadedModel}
      />

      <DebugPerformanceSection
        loadTimeMs={findLoadTimeMs(logs)}
        generationMetrics={findGenerationMetrics(logs)}
        isGenerating={lastRuntimeStatus?.status === "generating" || lastRuntimeStatus?.status === "cancelling"}
      />

      <DebugRecentLogs logs={logs} logsAvailable={logsAvailable} />

      <DebugPrivacySection contentLogged={report?.contentLogged ?? null} />
    </main>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import { sampleModels } from "@free-ai-open/model-registry";
import { selectRecommendedModel } from "@free-ai-open/model-router";
import type { ModelRouterResult } from "@free-ai-open/model-router";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { ModelStatusPill } from "../_components/ModelStatusPill";
import { PrivacyNotice } from "../_components/PrivacyNotice";
import { findModeLabel, findTaskLabel, isPerformanceMode, isTaskCategory } from "../_lib/catalog";
import { rejectionReasonLabel } from "../_lib/routeExplanation";

function ChatContent() {
  const searchParams = useSearchParams();
  const rawTask = searchParams.get("task");
  const rawMode = searchParams.get("mode");
  const task = isTaskCategory(rawTask) ? rawTask : null;
  const mode = isPerformanceMode(rawMode) ? rawMode : null;
  const taskLabel = findTaskLabel(task);
  const modeLabel = findModeLabel(mode);

  const [message, setMessage] = useState("");
  const [routeResult, setRouteResult] = useState<ModelRouterResult | null>(null);

  useEffect(() => {
    if (!task || !mode) return;
    let cancelled = false;

    detectDeviceProfile().then((deviceProfile) => {
      if (cancelled) return;

      const result = selectRecommendedModel({
        task,
        performanceMode: mode,
        deviceProfile,
        modelRegistry: sampleModels,
      });

      setRouteResult(result);
      logEvent(
        createLogEvent("router_decision", "info", {
          task,
          performanceMode: mode,
          deviceTier: deviceProfile.deviceTier,
          selectedModelId: result.selectedModel?.id ?? null,
          fallbackModelId: result.fallbackModel?.id ?? null,
          reasonCode: result.reasonCode,
          rejectedCount: result.rejectedModels.length,
        })
      );
    });

    return () => {
      cancelled = true;
    };
  }, [task, mode]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0 }}>Chat</h1>
        <ModelStatusPill taskLabel={taskLabel} modeLabel={modeLabel} modelName={routeResult?.selectedModel?.displayName} />
      </div>

      {task && mode && routeResult && (
        <section style={{ border: "1px solid #333", borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <strong>{routeResult.selectedModel ? "Recommended model" : "No model available yet"}</strong>
          <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.85 }}>{routeResult.humanReadableReason}</p>

          {routeResult.rejectedModels.length > 0 && (
            <details style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
              <summary style={{ cursor: "pointer" }}>
                Advanced: {routeResult.rejectedModels.length} model
                {routeResult.rejectedModels.length > 1 ? "s" : ""} not used
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                {routeResult.rejectedModels.map((rejected) => (
                  <li key={rejected.modelId}>
                    {rejected.modelId} — {rejectionReasonLabel(rejected.reason)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section style={{ border: "1px solid #333", borderRadius: 16, padding: 16, minHeight: 320 }}>
        <p style={{ opacity: 0.6 }}>
          No runtime connected yet. The local model will load here once the
          WebLLM runtime is wired in.
        </p>
      </section>

      <form style={{ display: "flex", gap: 12, marginTop: 16 }} onSubmit={(event) => event.preventDefault()}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask locally..."
          style={{ flex: 1, padding: 12, borderRadius: 12 }}
        />
        <button type="submit">Send</button>
      </form>

      <div style={{ marginTop: 24 }}>
        <PrivacyNotice />
      </div>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatContent />
    </Suspense>
  );
}

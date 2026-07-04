"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import { sampleModels } from "@free-ai-open/model-registry";
import { selectRecommendedModel } from "@free-ai-open/model-router";
import type { ModelRouterResult } from "@free-ai-open/model-router";
import { createInferenceRuntime } from "@free-ai-open/ai-runtime";
import type { InferenceRuntime, RuntimeState } from "@free-ai-open/ai-runtime";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { ModelStatusPill } from "../_components/ModelStatusPill";
import { PrivacyNotice } from "../_components/PrivacyNotice";
import { RuntimeStatusBadge } from "../_components/RuntimeStatusBadge";
import { ChatTranscript } from "../_components/ChatTranscript";
import type { ChatMessageItem } from "../_components/ChatTranscript";
import { findModeLabel, findTaskLabel, isPerformanceMode, isTaskCategory } from "../_lib/catalog";
import { rejectionReasonLabel } from "../_lib/routeExplanation";
import { runtimeErrorLabel } from "../_lib/runtimeErrorLabel";

const IDLE_RUNTIME_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };

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
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(IDLE_RUNTIME_STATE);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const runtimeRef = useRef<InferenceRuntime | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

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

  const teardownRuntime = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    const runtime = runtimeRef.current;
    const worker = workerRef.current;
    runtimeRef.current = null;
    workerRef.current = null;
    runtime?.dispose().finally(() => worker?.terminate());
  }, []);

  // Also used by the "Reload model" recovery button, so a stuck runtime
  // (e.g. after a cancel timeout) can be replaced without a page refresh.
  const initializeRuntime = useCallback(() => {
    teardownRuntime();

    const worker = new Worker(new URL("../../workers/inference.worker.ts", import.meta.url), { type: "module" });
    const runtime = createInferenceRuntime(worker);
    workerRef.current = worker;
    runtimeRef.current = runtime;
    unsubscribeRef.current = runtime.subscribe(setRuntimeState);
    setRuntimeState(runtime.getState());
    runtime.loadModel();
  }, [teardownRuntime]);

  useEffect(() => {
    if (!task || !mode) return;
    initializeRuntime();
    return () => teardownRuntime();
  }, [task, mode, initializeRuntime, teardownRuntime]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const runtime = runtimeRef.current;
    const prompt = message.trim();
    if (!runtime || !prompt || runtimeState.status !== "ready") return;

    const userMessage: ChatMessageItem = { id: crypto.randomUUID(), role: "user", content: prompt };
    const assistantId = crypto.randomUUID();
    setMessages((previous) => [...previous, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setMessage("");

    for await (const chunk of runtime.generate({ conversationId: "local-chat", prompt })) {
      if (chunk.type === "token") {
        setMessages((previous) =>
          previous.map((item) => (item.id === assistantId ? { ...item, content: item.content + chunk.text } : item))
        );
      } else if (chunk.type === "error") {
        break;
      }
    }
  }

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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ModelStatusPill taskLabel={taskLabel} modeLabel={modeLabel} modelName={routeResult?.selectedModel?.displayName} />
          {task && mode && <RuntimeStatusBadge state={runtimeState} />}
        </div>
      </div>

      {task && mode && routeResult && (
        <section style={{ border: "1px solid #333", borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <strong>{routeResult.selectedModel ? "Recommended model" : "No model available yet"}</strong>
          <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.85 }}>{routeResult.humanReadableReason}</p>
          <p style={{ margin: "8px 0 0", fontSize: 13, opacity: 0.6 }}>
            This first version runs a small placeholder model locally regardless of the recommendation above.
          </p>

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

      {runtimeState.status === "error" && runtimeState.error && (
        <section
          style={{
            border: "1px solid #e5484d",
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            background: "rgba(229, 72, 77, 0.08)",
          }}
        >
          <strong>Local model unavailable</strong>
          <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.9 }}>{runtimeErrorLabel(runtimeState.error.code)}</p>
          {(runtimeState.error.code === "cancel_timeout" || runtimeState.error.code === "generation_stalled") && (
            <button type="button" onClick={initializeRuntime} style={{ marginTop: 8 }}>
              Reload model
            </button>
          )}
        </section>
      )}

      <section style={{ border: "1px solid #333", borderRadius: 16, padding: 16, minHeight: 320 }}>
        <ChatTranscript messages={messages} />
      </section>

      <form style={{ display: "flex", gap: 12, marginTop: 16 }} onSubmit={handleSubmit}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask locally..."
          disabled={runtimeState.status !== "ready"}
          style={{ flex: 1, padding: 12, borderRadius: 12 }}
        />
        {runtimeState.status === "generating" ? (
          <button type="button" onClick={() => runtimeRef.current?.stopGeneration()}>
            Stop
          </button>
        ) : runtimeState.status === "cancelling" ? (
          <button type="button" disabled>
            Stopping…
          </button>
        ) : (
          <button type="submit" disabled={runtimeState.status !== "ready" || !message.trim()}>
            Send
          </button>
        )}
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

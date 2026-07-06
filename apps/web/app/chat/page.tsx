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
import {
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from "@free-ai-open/conversation-store";
import type { Conversation, ConversationId, ConversationMetadata } from "@free-ai-open/conversation-store";
import {
  buildConversationExport,
  ConversationExportError,
  parseConversationImport,
  prepareImportedConversations,
  serializeConversationExport,
} from "@free-ai-open/conversation-export";
import { ModelStatusPill } from "../_components/ModelStatusPill";
import { PrivacyNotice } from "../_components/PrivacyNotice";
import { RuntimeStatusBadge } from "../_components/RuntimeStatusBadge";
import { ChatTranscript } from "../_components/ChatTranscript";
import type { ChatMessageItem } from "../_components/ChatTranscript";
import { ChatHistorySidebar } from "../_components/ChatHistorySidebar";
import type { ConversationImportSummary } from "../_components/ConversationExportImportControls";
import { findModeLabel, findTaskLabel, isPerformanceMode, isTaskCategory } from "../_lib/catalog";
import { rejectionReasonLabel } from "../_lib/routeExplanation";
import { runtimeErrorLabel } from "../_lib/runtimeErrorLabel";
import { terminateWorkerAfter } from "../_lib/workerTeardown";
import { deriveConversationTitle, toChatMessageItems } from "../_lib/conversationMessages";
import { downloadTextFile } from "../_lib/downloadTextFile";
import {
  clearStoredActiveConversationId,
  getStoredActiveConversationId,
  setStoredActiveConversationId,
} from "../_lib/activeConversationStorage";

const IDLE_RUNTIME_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };

// Bounds how long teardown waits for a graceful runtime.dispose() (which
// calls the WebLLM engine's unload()) before terminating the worker anyway.
// A wedged engine (e.g. after a cancel timeout) can leave dispose() pending
// forever; the worker must never be leaked waiting on it.
const TEARDOWN_GRACE_MS = 2_000;

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
  const [conversations, setConversations] = useState<ConversationMetadata[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<ConversationId | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ConversationImportSummary | null>(null);
  const runtimeRef = useRef<InferenceRuntime | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const refreshConversations = useCallback(async () => {
    setConversations(await listConversations());
  }, []);

  // Resumes the last-viewed conversation after a refresh. Independent of the
  // task/mode runtime lifecycle effect below, so switching conversations
  // never re-initializes the WebLLM runtime.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const list = await listConversations();
      if (cancelled) return;
      setConversations(list);
      if (list.length === 0) return;

      const storedId = getStoredActiveConversationId();
      const targetId = (storedId && list.some((item) => item.id === storedId) ? storedId : list[0].id) as ConversationId;
      const conversation = await getConversation(targetId);
      if (cancelled || !conversation) return;

      setActiveConversationId(conversation.id);
      setMessages(toChatMessageItems(conversation));
      setStoredActiveConversationId(conversation.id);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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

    if (!worker) return;
    if (!runtime) {
      worker.terminate();
      return;
    }

    // Never depends on dispose() resolving: the worker is guaranteed to be
    // terminated within TEARDOWN_GRACE_MS regardless of whether the engine's
    // unload() call ever settles, so a new runtime can always be created
    // right after this call returns.
    terminateWorkerAfter(runtime.dispose(), worker, TEARDOWN_GRACE_MS);
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

  const isConversationSwitchBlocked = runtimeState.status === "generating" || runtimeState.status === "cancelling";

  function handleNewChat() {
    if (isConversationSwitchBlocked) return;
    setStorageNotice(null);
    setActiveConversationId(null);
    setMessages([]);
    clearStoredActiveConversationId();
  }

  async function handleSelectConversation(id: string) {
    if (isConversationSwitchBlocked) return;
    setStorageNotice(null);
    const conversation = await getConversation(id as ConversationId);
    if (!conversation) {
      setStorageNotice("Couldn't load this conversation locally.");
      return;
    }
    setActiveConversationId(conversation.id);
    setMessages(toChatMessageItems(conversation));
    setStoredActiveConversationId(conversation.id);
  }

  async function handleRenameConversation(id: string, title: string) {
    const updated = await updateConversationTitle(id as ConversationId, title);
    if (!updated) {
      setStorageNotice("Couldn't rename this conversation locally.");
      return;
    }
    await refreshConversations();
  }

  async function handleDeleteConversation(id: string) {
    if (isConversationSwitchBlocked) return;
    const success = await deleteConversation(id as ConversationId);
    if (!success) {
      setStorageNotice("Couldn't delete this conversation locally.");
      return;
    }
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
      clearStoredActiveConversationId();
    }
    await refreshConversations();
  }

  async function handleExportActiveConversation() {
    setStorageNotice(null);
    if (!activeConversationId) {
      setStorageNotice("No active conversation to export.");
      return;
    }

    const conversation = await getConversation(activeConversationId);
    if (!conversation) {
      setStorageNotice("Couldn't load this conversation locally to export it.");
      return;
    }

    try {
      const json = serializeConversationExport(buildConversationExport([conversation]));
      downloadTextFile(`freeai-open-conversation-${Date.now()}.json`, json);
    } catch {
      setStorageNotice("Couldn't build the export file for this conversation.");
    }
  }

  async function handleExportAllConversations() {
    setStorageNotice(null);
    const metadataList = await listConversations();
    if (metadataList.length === 0) {
      setStorageNotice("No conversations to export.");
      return;
    }

    const fullConversations = (await Promise.all(metadataList.map((item) => getConversation(item.id)))).filter(
      (conversation): conversation is Conversation => conversation !== null
    );
    if (fullConversations.length === 0) {
      setStorageNotice("Couldn't load conversations locally to export them.");
      return;
    }

    try {
      const json = serializeConversationExport(buildConversationExport(fullConversations));
      downloadTextFile(`freeai-open-conversations-${Date.now()}.json`, json);
    } catch {
      setStorageNotice("Couldn't build the export file.");
    }
  }

  async function handleImportFile(file: File) {
    setStorageNotice(null);
    setImportSummary(null);

    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportSummary({ importedCount: 0, skippedCount: 0, errors: ["Couldn't read the selected file."] });
      return;
    }

    let exportData;
    try {
      exportData = parseConversationImport(text);
    } catch (error) {
      const errors =
        error instanceof ConversationExportError
          ? error.errors
          : ["This file isn't a valid FreeAI Open conversation export."];
      setImportSummary({ importedCount: 0, skippedCount: 0, errors });
      return;
    }

    const existingIds = (await listConversations()).map((item) => item.id);
    const prepared = prepareImportedConversations(exportData, { existingIds });

    let importedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const conversation of prepared) {
      const created = await createConversation({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
      });
      if (!created) {
        skippedCount += 1;
        errors.push(`Couldn't import "${conversation.title}".`);
        continue;
      }

      importedCount += 1;
      for (const message of conversation.messages) {
        const saved = await addMessage(created.id, {
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        });
        if (!saved) {
          errors.push(`"${conversation.title}": a message couldn't be saved.`);
        }
      }
    }

    setImportSummary({ importedCount, skippedCount, errors });
    await refreshConversations();
  }

  function handleDismissImportSummary() {
    setImportSummary(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const runtime = runtimeRef.current;
    const prompt = message.trim();
    if (!runtime || !prompt || runtimeState.status !== "ready") return;

    setStorageNotice(null);
    let conversationId = activeConversationId;
    if (!conversationId) {
      const created = await createConversation({ title: deriveConversationTitle(prompt) });
      if (!created) {
        setStorageNotice("Couldn't start a local conversation. This chat will not be saved.");
      } else {
        conversationId = created.id;
        setActiveConversationId(created.id);
        setStoredActiveConversationId(created.id);
        await refreshConversations();
      }
    }

    const userMessage: ChatMessageItem = { id: crypto.randomUUID(), role: "user", content: prompt };
    const assistantId = crypto.randomUUID();
    setMessages((previous) => [...previous, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setMessage("");

    if (conversationId && !(await addMessage(conversationId, { role: "user", content: prompt }))) {
      setStorageNotice("Couldn't save your message locally.");
    }

    let assistantText = "";
    for await (const chunk of runtime.generate({ conversationId: conversationId ?? "local-chat", prompt })) {
      if (chunk.type === "token") {
        assistantText += chunk.text;
        setMessages((previous) =>
          previous.map((item) => (item.id === assistantId ? { ...item, content: item.content + chunk.text } : item))
        );
      } else if (chunk.type === "error") {
        break;
      }
    }

    if (conversationId && assistantText.length > 0) {
      if (!(await addMessage(conversationId, { role: "assistant", content: assistantText }))) {
        setStorageNotice("Couldn't save the reply locally.");
      } else {
        await refreshConversations();
      }
    }
  }

  return (
    <div style={{ display: "flex", gap: 24, maxWidth: 1200, margin: "0 auto", padding: 24, alignItems: "flex-start" }}>
      <ChatHistorySidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        disabled={isConversationSwitchBlocked}
        onNewChat={handleNewChat}
        onSelect={handleSelectConversation}
        onRename={handleRenameConversation}
        onDelete={handleDeleteConversation}
        onExportActive={handleExportActiveConversation}
        onExportAll={handleExportAllConversations}
        onImportFile={handleImportFile}
        importSummary={importSummary}
        onDismissImportSummary={handleDismissImportSummary}
      />

      <main style={{ flex: 1, minWidth: 0 }}>
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

      {storageNotice && (
        <section
          style={{
            border: "1px solid #a1743d",
            borderRadius: 16,
            padding: 12,
            marginBottom: 16,
            background: "rgba(161, 116, 61, 0.1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            fontSize: 13,
          }}
        >
          <span>{storageNotice}</span>
          <button type="button" onClick={() => setStorageNotice(null)}>
            Dismiss
          </button>
        </section>
      )}

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
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatContent />
    </Suspense>
  );
}

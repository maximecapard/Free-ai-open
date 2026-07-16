"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import { sampleModels } from "@free-ai-open/model-registry";
import { selectRecommendedModel } from "@free-ai-open/model-router";
import type { ModelRouterResult } from "@free-ai-open/model-router";
import { createInferenceRuntime } from "@free-ai-open/ai-runtime";
import type { GenerationStopReason, InferenceRuntime, RuntimeErrorCode, RuntimeState } from "@free-ai-open/ai-runtime";
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
  parseConversationImport,
  prepareImportedConversations,
  serializeConversationExport,
} from "@free-ai-open/conversation-export";
import { ModelStatusPill } from "../_components/ModelStatusPill";
import { PrivacyNotice } from "../_components/PrivacyNotice";
import { RuntimeStatusBadge } from "../_components/RuntimeStatusBadge";
import { ChatTranscript } from "../_components/ChatTranscript";
import type { ChatMessageItem } from "../_components/ChatTranscript";
import { ChatHistoryDrawerPanel } from "../_components/ChatHistoryDrawerPanel";
import { useMobileHistoryDrawer } from "../_components/useMobileHistoryDrawer";
import type { ConversationImportSummary } from "../_components/ConversationExportImportControls";
import { findModeLabelKey, findTaskLabelKey, isPerformanceMode, isTaskCategory } from "../_lib/catalog";
import { rejectionReasonKey, routeDecisionKey } from "../_lib/routeExplanation";
import { runtimeErrorKey } from "../_lib/runtimeErrorLabel";
import { terminateWorkerAfter } from "../_lib/workerTeardown";
import { deriveConversationTitle, toChatMessageItems } from "../_lib/conversationMessages";
import { downloadTextFile } from "../_lib/downloadTextFile";
import {
  clearStoredActiveConversationId,
  getStoredActiveConversationId,
  setStoredActiveConversationId,
} from "../_lib/activeConversationStorage";
import {
  generationNoticeKey,
  shouldDiscardPartialAssistantOutput,
  shouldPersistAssistantOutput,
} from "../_lib/generationPersistence";
import { recordRuntimeRecoveryEvent } from "../_lib/runtimeRecovery";
import { canSendChatMessage, isConversationSwitchBlockedStatus } from "../_lib/runtimeUiState";
import { createStreamingTextBuffer } from "../_lib/streamingBuffer";
import { useLocale, useTranslations } from "../_i18n/LocaleContext";

const IDLE_RUNTIME_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };

// Bounds how long teardown waits for a graceful runtime.dispose() (which
// calls the WebLLM engine's unload()) before terminating the worker anyway.
// A wedged engine (e.g. after a cancel timeout) can leave dispose() pending
// forever; the worker must never be leaked waiting on it.
const TEARDOWN_GRACE_MS = 2_000;
function ChatContent() {
  const t = useTranslations();
  const { locale } = useLocale();
  const searchParams = useSearchParams();
  const rawTask = searchParams.get("task");
  const rawMode = searchParams.get("mode");
  const task = isTaskCategory(rawTask) ? rawTask : null;
  const mode = isPerformanceMode(rawMode) ? rawMode : null;
  const taskLabelKey = findTaskLabelKey(task);
  const modeLabelKey = findModeLabelKey(mode);
  const taskLabel = taskLabelKey ? t(taskLabelKey) : null;
  const modeLabel = modeLabelKey ? t(modeLabelKey) : null;

  const drawer = useMobileHistoryDrawer();
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
  const pendingAssistantIdRef = useRef<string | null>(null);
  const recoveryEpochRef = useRef(0);
  const recoveryInProgressRef = useRef(false);

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
  const initializeRuntime = useCallback(async (options: { recovery?: boolean } = {}) => {
    const isRecovery = options.recovery === true;
    const recoveryEpoch = ++recoveryEpochRef.current;
    if (isRecovery) {
      recordRuntimeRecoveryEvent("runtime.recovery.started", "info", "recovering");
    }

    teardownRuntime();

    const worker = new Worker(new URL("../../workers/inference.worker.ts", import.meta.url), { type: "module" });
    const runtime = createInferenceRuntime(worker);
    workerRef.current = worker;
    runtimeRef.current = runtime;
    unsubscribeRef.current = runtime.subscribe(setRuntimeState);
    setRuntimeState(isRecovery ? { status: "recovering", modelId: null, loadProgress: 0, error: null } : runtime.getState());
    try {
      await runtime.loadModel(undefined, { initialStatus: isRecovery ? "recovering" : "loading_model" });
    } catch {
      if (recoveryEpoch === recoveryEpochRef.current && runtimeRef.current === runtime) {
        setRuntimeState({
          status: "error",
          modelId: runtime.getState().modelId,
          loadProgress: runtime.getState().loadProgress,
          error: { code: "unknown", message: "Runtime recovery failed." },
        });
        if (isRecovery) {
          recordRuntimeRecoveryEvent("runtime.recovery.failed", "error", "error", "RUNTIME_RECOVERY_FAILED");
        }
      }
      return;
    }

    if (recoveryEpoch !== recoveryEpochRef.current || runtimeRef.current !== runtime) return;
    const nextState = runtime.getState();
    if (isRecovery) {
      if (nextState.status === "ready") {
        recordRuntimeRecoveryEvent("runtime.recovery.completed", "info", "ready");
      } else {
        recordRuntimeRecoveryEvent(
          "runtime.recovery.failed",
          "error",
          "error",
          nextState.error?.code ? nextState.error.code.toUpperCase() : "RUNTIME_RECOVERY_FAILED"
        );
      }
    }
  }, [teardownRuntime]);

  const recoverRuntime = useCallback(async () => {
    if (recoveryInProgressRef.current) return;
    recoveryInProgressRef.current = true;
    try {
      await initializeRuntime({ recovery: true });
    } finally {
      recoveryInProgressRef.current = false;
    }
  }, [initializeRuntime]);

  useEffect(() => {
    if (!task || !mode) return;
    void initializeRuntime();
    return () => teardownRuntime();
  }, [task, mode, initializeRuntime, teardownRuntime]);

  const isConversationSwitchBlocked = isConversationSwitchBlockedStatus(runtimeState.status);

  useEffect(() => {
    if (runtimeState.status !== "error" || !runtimeState.error || !pendingAssistantIdRef.current) return;

    const noticeKey = generationNoticeKey(null, runtimeState.error.code);
    if (!noticeKey) return;

    const assistantId = pendingAssistantIdRef.current;
    pendingAssistantIdRef.current = null;
    setMessages((previous) => previous.filter((item) => item.id !== assistantId));
    setStorageNotice(t(noticeKey));
    if (runtimeState.error.code === "cancel_timeout") {
      void recoverRuntime();
    }
  }, [recoverRuntime, runtimeState.status, runtimeState.error, t]);

  const appendAssistantText = useCallback((assistantId: string, text: string) => {
    setMessages((previous) =>
      previous.map((item) => (item.id === assistantId ? { ...item, content: item.content + text } : item))
    );
  }, []);

  const handleNewChat = useCallback(() => {
    if (isConversationSwitchBlocked) return;
    setStorageNotice(null);
    setActiveConversationId(null);
    setMessages([]);
    clearStoredActiveConversationId();
  }, [isConversationSwitchBlocked]);

  const handleSelectConversation = useCallback(async (id: string) => {
    if (isConversationSwitchBlocked) return;
    setStorageNotice(null);
    const conversation = await getConversation(id as ConversationId);
    if (!conversation) {
      setStorageNotice(t("storageNotice.couldNotLoadConversation"));
      return;
    }
    setActiveConversationId(conversation.id);
    setMessages(toChatMessageItems(conversation));
    setStoredActiveConversationId(conversation.id);
  }, [isConversationSwitchBlocked, t]);

  const handleRenameConversation = useCallback(async (id: string, title: string) => {
    const updated = await updateConversationTitle(id as ConversationId, title);
    if (!updated) {
      setStorageNotice(t("storageNotice.couldNotRename"));
      return;
    }
    await refreshConversations();
  }, [refreshConversations, t]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    if (isConversationSwitchBlocked) return;
    const success = await deleteConversation(id as ConversationId);
    if (!success) {
      setStorageNotice(t("storageNotice.couldNotDelete"));
      return;
    }
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
      clearStoredActiveConversationId();
    }
    await refreshConversations();
  }, [activeConversationId, isConversationSwitchBlocked, refreshConversations, t]);

  const handleExportActiveConversation = useCallback(async () => {
    setStorageNotice(null);
    if (!activeConversationId) {
      setStorageNotice(t("backup.noActiveConversation"));
      return;
    }

    const conversation = await getConversation(activeConversationId);
    if (!conversation) {
      setStorageNotice(t("backup.couldNotLoadConversation"));
      return;
    }

    try {
      const json = serializeConversationExport(buildConversationExport([conversation]));
      downloadTextFile(`freeai-open-conversation-${Date.now()}.json`, json);
    } catch {
      setStorageNotice(t("backup.couldNotBuildExportOne"));
    }
  }, [activeConversationId, t]);

  const handleExportAllConversations = useCallback(async () => {
    setStorageNotice(null);
    const metadataList = await listConversations();
    if (metadataList.length === 0) {
      setStorageNotice(t("backup.noConversations"));
      return;
    }

    const fullConversations = (await Promise.all(metadataList.map((item) => getConversation(item.id)))).filter(
      (conversation): conversation is Conversation => conversation !== null
    );
    if (fullConversations.length === 0) {
      setStorageNotice(t("backup.couldNotLoadConversations"));
      return;
    }

    try {
      const json = serializeConversationExport(buildConversationExport(fullConversations));
      downloadTextFile(`freeai-open-conversations-${Date.now()}.json`, json);
    } catch {
      setStorageNotice(t("backup.couldNotBuildExportAll"));
    }
  }, [t]);

  const handleImportFile = useCallback(async (file: File) => {
    setStorageNotice(null);
    setImportSummary(null);

    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportSummary({ importedCount: 0, skippedCount: 0, errors: [t("backup.couldNotReadFile")] });
      return;
    }

    let exportData;
    try {
      exportData = parseConversationImport(text);
    } catch {
      setImportSummary({ importedCount: 0, skippedCount: 0, errors: [t("backup.invalidFile")] });
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
        errors.push(t("backup.couldNotImportConversation", { title: conversation.title }));
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
          errors.push(t("backup.messageNotSaved", { title: conversation.title }));
        }
      }
    }

    setImportSummary({ importedCount, skippedCount, errors });
    await refreshConversations();
  }, [refreshConversations, t]);

  const handleDismissImportSummary = useCallback(() => {
    setImportSummary(null);
  }, []);

  const handleNewChatFromDrawer = useCallback(() => {
    handleNewChat();
    drawer.startNewChat();
  }, [drawer.startNewChat, handleNewChat]);

  const handleSelectConversationFromDrawer = useCallback((id: string) => {
    void handleSelectConversation(id);
    drawer.selectConversation();
  }, [drawer.selectConversation, handleSelectConversation]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const runtime = runtimeRef.current;
    const prompt = message.trim();
    if (!runtime || !canSendChatMessage(runtimeState.status, prompt)) return;

    setStorageNotice(null);
    let conversationId = activeConversationId;
    if (!conversationId) {
      const created = await createConversation({ title: deriveConversationTitle(prompt) });
      if (!created) {
        setStorageNotice(t("storageNotice.couldNotStartConversation"));
      } else {
        conversationId = created.id;
        setActiveConversationId(created.id);
        setStoredActiveConversationId(created.id);
        await refreshConversations();
      }
    }

    const userMessage: ChatMessageItem = { id: crypto.randomUUID(), role: "user", content: prompt };
    const assistantId = crypto.randomUUID();
    pendingAssistantIdRef.current = assistantId;
    setMessages((previous) => [...previous, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setMessage("");

    if (conversationId && !(await addMessage(conversationId, { role: "user", content: prompt }))) {
      setStorageNotice(t("storageNotice.couldNotSaveMessage"));
    }

    let assistantText = "";
    let stopReason: GenerationStopReason | null = null;
    let runtimeErrorCode: RuntimeErrorCode | undefined;
    const streamBuffer = createStreamingTextBuffer({
      onFlush: (text) => appendAssistantText(assistantId, text),
    });

    try {
      for await (const chunk of runtime.generate({ conversationId: conversationId ?? "local-chat", prompt, responseLocale: locale })) {
        if (chunk.type === "token") {
          assistantText += chunk.text;
          streamBuffer.append(chunk.text);
        } else if (chunk.type === "done") {
          stopReason = chunk.reason;
        } else if (chunk.type === "error") {
          runtimeErrorCode = chunk.error.code;
          break;
        }
      }
    } finally {
      streamBuffer.flush();
    }

    if (shouldDiscardPartialAssistantOutput(stopReason, runtimeErrorCode)) {
      pendingAssistantIdRef.current = null;
      setMessages((previous) => previous.filter((item) => item.id !== assistantId));
      const noticeKey = stopReason === "cancelled" ? "storageNotice.generationStoppedRecovering" : generationNoticeKey(stopReason, runtimeErrorCode);
      if (noticeKey) setStorageNotice(t(noticeKey));
      if (stopReason === "cancelled") {
        await recoverRuntime();
      }
      return;
    }

    pendingAssistantIdRef.current = null;
    if (stopReason === "completed" && assistantText.length === 0) {
      setMessages((previous) => previous.filter((item) => item.id !== assistantId));
      return;
    }

    if (conversationId && shouldPersistAssistantOutput(stopReason, assistantText)) {
      if (!(await addMessage(conversationId, { role: "assistant", content: assistantText }))) {
        setStorageNotice(t("storageNotice.couldNotSaveReply"));
      } else {
        await refreshConversations();
      }
    }
  }

  return (
    <div
      className="chat-layout"
      style={{ display: "flex", gap: 24, maxWidth: 1200, margin: "0 auto", padding: 24, alignItems: "flex-start" }}
    >
      <ChatHistoryDrawerPanel
        isOpen={drawer.isOpen}
        isDesktopViewport={drawer.isDesktopViewport}
        panelId={drawer.panelId}
        onClose={drawer.close}
        onBackdropClick={drawer.dismissBackdrop}
        conversations={conversations}
        activeConversationId={activeConversationId}
        disabled={isConversationSwitchBlocked}
        onNewChat={handleNewChatFromDrawer}
        onSelect={handleSelectConversationFromDrawer}
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            ref={drawer.triggerRef}
            type="button"
            className="chat-history-trigger"
            aria-haspopup="dialog"
            aria-expanded={drawer.isOpen}
            aria-controls={drawer.panelId}
            onClick={drawer.toggle}
          >
            {drawer.isOpen ? t("history.closeHistory") : t("history.openHistory")}
          </button>
          <h1 style={{ margin: 0 }}>{t("chat.heading")}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ModelStatusPill taskLabel={taskLabel} modeLabel={modeLabel} modelName={routeResult?.selectedModel?.displayName} />
          {task && mode && <RuntimeStatusBadge state={runtimeState} />}
        </div>
      </div>

      {storageNotice && (
        <section
          role="status"
          aria-live="polite"
          style={{
            border: "1px solid var(--color-warning)",
            borderRadius: 16,
            padding: 12,
            marginBottom: 16,
            background: "var(--color-warning-bg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            fontSize: 13,
          }}
        >
          <span>{storageNotice}</span>
          <button type="button" onClick={() => setStorageNotice(null)}>
            {t("common.dismiss")}
          </button>
        </section>
      )}

      {task && mode && routeResult && (
        <section style={{ border: "1px solid var(--color-border)", borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <strong>{routeResult.selectedModel ? t("chat.recommendedModel") : t("chat.noModelAvailable")}</strong>
          <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.85 }}>
            {t(routeDecisionKey(routeResult), {
              task: taskLabel ?? task ?? t("chat.noTaskSelected"),
              mode: modeLabel ?? mode ?? "",
              model: routeResult.selectedModel?.displayName ?? "",
              fallback: routeResult.fallbackModel?.displayName ?? "",
              count: routeResult.rejectedModels.length,
            })}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 13, opacity: 0.6 }}>{t("chat.placeholderModelNote")}</p>

          {routeResult.rejectedModels.length > 0 && (
            <details style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
              <summary style={{ cursor: "pointer" }}>
                {t("chat.advancedNotUsed", {
                  count: routeResult.rejectedModels.length,
                  plural: routeResult.rejectedModels.length > 1 ? "s" : "",
                })}
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                {routeResult.rejectedModels.map((rejected) => (
                  <li key={rejected.modelId}>
                    {rejected.modelId} — {t(rejectionReasonKey(rejected.reason))}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {runtimeState.status === "error" && runtimeState.error && (
        <section
          role="alert"
          style={{
            border: "1px solid var(--color-danger)",
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            background: "var(--color-danger-bg)",
          }}
        >
          <strong>{t("chat.localModelUnavailable")}</strong>
          <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.9 }}>{t(runtimeErrorKey(runtimeState.error.code))}</p>
          <button type="button" onClick={() => void initializeRuntime()} style={{ marginTop: 8 }}>
            {t("chat.reloadModel")}
          </button>
        </section>
      )}

      <section style={{ border: "1px solid var(--color-border)", borderRadius: 16, padding: 16, minHeight: 320 }}>
        <ChatTranscript messages={messages} />
      </section>

      <form style={{ display: "flex", gap: 12, marginTop: 16 }} onSubmit={handleSubmit}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t("chat.askPlaceholder")}
          aria-label={t("chat.askPlaceholder")}
          disabled={runtimeState.status !== "ready"}
          style={{ flex: 1, padding: 12, borderRadius: 12 }}
        />
        {runtimeState.status === "generating" ? (
          <button type="button" onClick={() => runtimeRef.current?.stopGeneration()}>
            {t("common.stop")}
          </button>
        ) : runtimeState.status === "cancelling" ? (
          <button type="button" disabled aria-busy="true">
            {t("common.stopping")}
          </button>
        ) : (
          <button type="submit" disabled={!canSendChatMessage(runtimeState.status, message)}>
            {t("common.send")}
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

"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TaskCategory } from "@free-ai-open/types";
import {
  addMessage,
  createConversation,
  getConversation,
  listConversations,
} from "@free-ai-open/conversation-store";
import type { Conversation } from "@free-ai-open/conversation-store";
import {
  buildConversationExport,
  parseConversationImport,
  prepareImportedConversations,
  serializeConversationExport,
} from "@free-ai-open/conversation-export";
import { ChatHistoryDrawerPanel } from "../_components/ChatHistoryDrawerPanel";
import type { ConversationImportSummary } from "../_components/ConversationExportImportControls";
import { ChatTranscript } from "../_components/ChatTranscript";
import { ModelDownloadConsent } from "../_components/ModelDownloadConsent";
import { ModelStatusPill } from "../_components/ModelStatusPill";
import { NewChatTaskDialog } from "../_components/NewChatTaskDialog";
import { PrivacyNotice } from "../_components/PrivacyNotice";
import { RuntimeStatusBadge } from "../_components/RuntimeStatusBadge";
import { useMobileHistoryDrawer } from "../_components/useMobileHistoryDrawer";
import { findModeLabelKey, findTaskLabelKey, isPerformanceMode, isTaskCategory } from "../_lib/catalog";
import { resolveChatEmptyStateReason } from "../_lib/chatEmptyState";
import { downloadTextFile } from "../_lib/downloadTextFile";
import { pickFriendlyRouteExplanation } from "../_lib/friendlyRouteExplanation";
import { useOnlineStatus } from "../_components/useOnlineStatus";
import { isGettingStartedCompleted } from "../_lib/gettingStartedPreference";
import { runtimeErrorKey } from "../_lib/runtimeErrorLabel";
import { canSendChatMessage } from "../_lib/runtimeUiState";
import { useLocale, useTranslations } from "../_i18n/LocaleContext";
import { useAppRuntime } from "../_runtime/AppRuntimeProvider";

function ChatContent() {
  const t = useTranslations();
  const { locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const drawer = useMobileHistoryDrawer();
  const isOnline = useOnlineStatus();
  const {
    runtimeState,
    performanceMode,
    activeConversationTask,
    routerDecision,
    selectedModel,
    pendingModelSwitch,
    isRoutingInProgress,
    isFallbackRetry,
    conversations,
    activeConversationId,
    messages,
    storageNotice,
    isConversationSwitchBlocked,
    configureChatRoute,
    refreshConversations,
    clearStorageNotice,
    setStorageNotice,
    startNewConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    sendMessage,
    stopGeneration,
    reloadRuntime,
    confirmModelSwitch,
    cancelModelSwitch,
  } = useAppRuntime();

  const rawTask = searchParams.get("task");
  const rawMode = searchParams.get("mode");
  const taskFromQuery = isTaskCategory(rawTask) ? rawTask : null;
  const modeFromQuery = isPerformanceMode(rawMode) ? rawMode : null;
  const modeLabelKey = findModeLabelKey(performanceMode ?? modeFromQuery);
  const taskLabelKey = findTaskLabelKey(activeConversationTask);
  const taskLabel = taskLabelKey ? t(taskLabelKey) : null;
  const modeLabel = modeLabelKey ? t(modeLabelKey) : null;
  const storageNoticeText = storageNotice ? t(storageNotice.key, storageNotice.params) : null;
  const friendlyExplanation = routerDecision
    ? pickFriendlyRouteExplanation({
        reasons: routerDecision.reasons,
        taskLabel: taskLabel ?? activeConversationTask,
        localeLabel: locale === "fr" ? t("friendlyRoute.localeName.fr") : t("friendlyRoute.localeName.en"),
      })
    : null;
  const emptyStateReason = routerDecision ? resolveChatEmptyStateReason(routerDecision) : null;

  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [importSummary, setImportSummary] = useState<ConversationImportSummary | null>(null);
  const [isNewChatDialogOpen, setIsNewChatDialogOpen] = useState(false);
  const lastFocusedBeforeDialogRef = useRef<HTMLElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  // First-run setup owns only global performance mode. New chat asks only for
  // usage/task, so arriving at /chat before setup must redirect once.
  useEffect(() => {
    const completed = isGettingStartedCompleted();
    setIsSetupComplete(completed);
    if (!completed) router.replace("/onboarding");
  }, [router]);

  useEffect(() => {
    configureChatRoute(taskFromQuery, modeFromQuery);
  }, [configureChatRoute, modeFromQuery, taskFromQuery]);

  const handleExportActiveConversation = useCallback(async () => {
    setStorageNotice(null);
    if (!activeConversationId) {
      setStorageNotice({ key: "backup.noActiveConversation" });
      return;
    }

    const conversation = await getConversation(activeConversationId);
    if (!conversation) {
      setStorageNotice({ key: "backup.couldNotLoadConversation" });
      return;
    }

    try {
      const json = serializeConversationExport(buildConversationExport([conversation]));
      downloadTextFile(`freeai-open-conversation-${Date.now()}.json`, json);
    } catch {
      setStorageNotice({ key: "backup.couldNotBuildExportOne" });
    }
  }, [activeConversationId, setStorageNotice]);

  const handleExportAllConversations = useCallback(async () => {
    setStorageNotice(null);
    const metadataList = await listConversations();
    if (metadataList.length === 0) {
      setStorageNotice({ key: "backup.noConversations" });
      return;
    }

    const fullConversations = (await Promise.all(metadataList.map((item) => getConversation(item.id)))).filter(
      (conversation): conversation is Conversation => conversation !== null
    );
    if (fullConversations.length === 0) {
      setStorageNotice({ key: "backup.couldNotLoadConversations" });
      return;
    }

    try {
      const json = serializeConversationExport(buildConversationExport(fullConversations));
      downloadTextFile(`freeai-open-conversations-${Date.now()}.json`, json);
    } catch {
      setStorageNotice({ key: "backup.couldNotBuildExportAll" });
    }
  }, [setStorageNotice]);

  const handleImportFile = useCallback(
    async (file: File) => {
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
          task: conversation.task,
        });
        if (!created) {
          skippedCount += 1;
          errors.push(t("backup.couldNotImportConversation", { title: conversation.title }));
          continue;
        }

        importedCount += 1;
        for (const importedMessage of conversation.messages) {
          const saved = await addMessage(created.id, {
            id: importedMessage.id,
            role: importedMessage.role,
            content: importedMessage.content,
            createdAt: importedMessage.createdAt,
          });
          if (!saved) {
            errors.push(t("backup.messageNotSaved", { title: conversation.title }));
          }
        }
      }

      setImportSummary({ importedCount, skippedCount, errors });
      await refreshConversations();
    },
    [refreshConversations, setStorageNotice, t]
  );

  const handleDismissImportSummary = useCallback(() => {
    setImportSummary(null);
  }, []);

  const handleOpenNewChatDialog = useCallback(() => {
    if (isConversationSwitchBlocked) return;
    lastFocusedBeforeDialogRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsNewChatDialogOpen(true);
  }, [isConversationSwitchBlocked]);

  const handleCloseNewChatDialog = useCallback(() => {
    setIsNewChatDialogOpen(false);
    lastFocusedBeforeDialogRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSelectNewChatTask = useCallback(
    (task: TaskCategory) => {
      if (!startNewConversation(task)) return;
      setIsNewChatDialogOpen(false);
      drawer.startNewChat();
      lastFocusedBeforeDialogRef.current?.focus({ preventScroll: true });
    },
    [drawer, startNewConversation]
  );

  const handleSelectConversationFromDrawer = useCallback(
    (id: string) => {
      void selectConversation(id);
      drawer.selectConversation();
    },
    [drawer, selectConversation]
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const prompt = message.trim();
    if (!canSendChatMessage(runtimeState.status, prompt)) return;

    setMessage("");
    await sendMessage(prompt, locale);
  }

  if (isSetupComplete !== true) return null;

  return (
    <div className="chat-layout">
      <ChatHistoryDrawerPanel
        isOpen={drawer.isOpen}
        isDesktopViewport={drawer.isDesktopViewport}
        panelId={drawer.panelId}
        panelRef={drawer.panelRef}
        closeButtonRef={drawer.closeButtonRef}
        onClose={drawer.close}
        onBackdropClick={drawer.dismissBackdrop}
        conversations={conversations}
        activeConversationId={activeConversationId}
        disabled={isConversationSwitchBlocked}
        onNewChat={handleOpenNewChatDialog}
        onSelect={handleSelectConversationFromDrawer}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onExportActive={handleExportActiveConversation}
        onExportAll={handleExportAllConversations}
        onImportFile={handleImportFile}
        importSummary={importSummary}
        onDismissImportSummary={handleDismissImportSummary}
      />

      <main ref={drawer.backgroundRef} className="chat-main">
        <div className="chat-main__header">
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
              <h1 className="fo-page-title" style={{ margin: 0, fontSize: 24 }}>
                {t("chat.heading")}
              </h1>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <ModelStatusPill taskLabel={taskLabel} modeLabel={modeLabel} modelName={selectedModel?.displayName} />
              {performanceMode && (
                <RuntimeStatusBadge
                  state={runtimeState}
                  isRoutingInProgress={isRoutingInProgress}
                  isFallbackRetry={isFallbackRetry}
                  hasPendingModelSwitch={Boolean(pendingModelSwitch)}
                />
              )}
            </div>
          </div>

          {performanceMode && selectedModel && friendlyExplanation && (
            <p role="status" className="fo-muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
              {t(friendlyExplanation.key, friendlyExplanation.params)}
            </p>
          )}

          {storageNoticeText && (
            <section
              role="status"
              aria-live="polite"
              className="fo-inline-notice"
              style={{
                borderColor: "var(--fo-warning)",
                background: "var(--fo-warning-soft)",
                marginBottom: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                fontSize: 13,
              }}
            >
              <span>{storageNoticeText}</span>
              <button type="button" className="fo-button fo-button-secondary" onClick={clearStorageNotice}>
                {t("common.dismiss")}
              </button>
            </section>
          )}

          {/* Reason codes, warnings, and rejected models are technical detail —
              kept on /debug so normal chat stays simple. This only surfaces
              the cases a chatting user needs to act on: nothing to load, or
              why WebGPU specifically blocks every model on this browser. */}
          {performanceMode && routerDecision && !selectedModel && (
            <section role="alert" className="fo-inline-notice" style={{ marginBottom: 16 }}>
              {emptyStateReason === "webgpu_unavailable" ? (
                <>
                  <strong>{t("chat.webgpuUnavailableTitle")}</strong>
                  <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--fo-text)" }}>{t("chat.webgpuUnavailableBody")}</p>
                </>
              ) : (
                <>
                  <strong>{t("chat.noModelAvailable")}</strong>
                  <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--fo-text)" }}>
                    {t("router.noCompatible", {
                      task: taskLabel ?? activeConversationTask,
                      count: routerDecision.rejectedModels.length,
                    })}
                  </p>
                </>
              )}
            </section>
          )}

          {performanceMode && emptyStateReason === "manual_model_ineligible" && (
            <p role="status" className="fo-muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
              {t("chat.manualModelIneligibleNotice")}
            </p>
          )}

          {pendingModelSwitch && (
            <ModelDownloadConsent
              pendingModelSwitch={pendingModelSwitch}
              onConfirm={() => void confirmModelSwitch()}
              onCancel={cancelModelSwitch}
            />
          )}

          {runtimeState.status === "error" && runtimeState.error && (
            <section role="alert" className="fo-inline-notice" style={{ borderColor: "var(--fo-danger)", background: "var(--fo-danger-soft)", marginBottom: 16 }}>
              <strong>{t("chat.localModelUnavailable")}</strong>
              <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--fo-text)" }}>{t(runtimeErrorKey(runtimeState.error.code))}</p>
              {!isOnline && (
                <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--fo-text)" }}>{t("chat.offlineNotice")}</p>
              )}
              <button type="button" className="fo-button fo-button-secondary" onClick={() => void reloadRuntime()} style={{ marginTop: 8 }}>
                {t("chat.reloadModel")}
              </button>
              <details className="fo-muted" style={{ marginTop: 8, fontSize: 12 }}>
                <summary style={{ cursor: "pointer" }}>{t("chat.technicalDetails")}</summary>
                <p className="fo-technical-value" style={{ margin: "6px 0 0" }}>
                  {runtimeState.error.code}
                </p>
              </details>
            </section>
          )}
        </div>

        <div ref={transcriptScrollRef} className="chat-main__scroll">
          <section className="fo-card" style={{ padding: 16, minHeight: 320 }}>
            <ChatTranscript messages={messages} scrollContainerRef={transcriptScrollRef} />
          </section>
        </div>

        <div className="chat-main__composer">
          <form style={{ display: "flex", gap: 12, alignItems: "flex-end" }} onSubmit={handleSubmit}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={t("chat.askPlaceholder")}
              aria-label={t("chat.composerLabel")}
              disabled={runtimeState.status !== "ready"}
              rows={2}
              enterKeyHint="send"
              style={{
                flex: 1,
                resize: "vertical",
                minHeight: 44,
                maxHeight: 220,
                padding: "10px 14px",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
            {runtimeState.status === "generating" ? (
              <button type="button" className="fo-button fo-button-secondary" onClick={stopGeneration}>
                {t("common.stop")}
              </button>
            ) : runtimeState.status === "cancelling" ? (
              <button type="button" className="fo-button fo-button-secondary" disabled aria-busy="true">
                {t("common.stopping")}
              </button>
            ) : (
              <button type="submit" className="fo-button fo-button-primary" disabled={!canSendChatMessage(runtimeState.status, message)}>
                {t("common.send")}
              </button>
            )}
          </form>
          <p className="fo-muted" style={{ margin: "6px 0 0", fontSize: 12, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            {t("chat.composerHint")}
          </p>
          <div style={{ marginTop: 16 }}>
            <PrivacyNotice />
          </div>
        </div>
      </main>

      <NewChatTaskDialog
        isOpen={isNewChatDialogOpen}
        onClose={handleCloseNewChatDialog}
        onSelectTask={handleSelectNewChatTask}
      />
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

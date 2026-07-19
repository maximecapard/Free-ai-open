"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createInferenceRuntime } from "@free-ai-open/ai-runtime";
import type {
  GenerationStopReason,
  InferenceRuntime,
  RuntimeErrorCode,
  RuntimeLocale,
  RuntimeState,
} from "@free-ai-open/ai-runtime";
import {
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from "@free-ai-open/conversation-store";
import type { ConversationId, ConversationMetadata } from "@free-ai-open/conversation-store";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { RouterDecision } from "@free-ai-open/model-router";
import type { PerformanceMode, TaskCategory } from "@free-ai-open/types";
import type { ChatMessageItem } from "../_components/ChatTranscript";
import { useLocale } from "../_i18n/LocaleContext";
import type { TranslationKey } from "../_i18n/dictionary";
import {
  clearStoredActiveConversationId,
  getStoredActiveConversationId,
  setStoredActiveConversationId,
} from "../_lib/activeConversationStorage";
import { resolveConversationTask } from "../_lib/catalog";
import { deriveConversationTitle, toChatMessageItems } from "../_lib/conversationMessages";
import {
  generationNoticeKey,
  shouldDiscardPartialAssistantOutput,
  shouldPersistAssistantOutput,
} from "../_lib/generationPersistence";
import { getStoredPerformanceMode, setStoredPerformanceMode } from "../_lib/gettingStartedPreference";
import type { ModelSelectionMode } from "../_lib/manualModelPreference";
import { recordModelPerformanceObservation } from "../_lib/modelObservationStore";
import { buildGenerationObservation } from "../_lib/performanceObservationBuilder";
import {
  appendAssistantChunk,
  isGenerationCurrent,
  removeAssistantMessage,
  type ActiveGenerationDescriptor,
} from "../_lib/persistentGenerationState";
import { canSendChatMessage, isConversationSwitchBlockedStatus } from "../_lib/runtimeUiState";
import { createStreamingTextBuffer } from "../_lib/streamingBuffer";
import { createPersistentRuntimeLifecycle } from "./persistentRuntimeLifecycle";
import { registryIdForWebllmModelId } from "./routingOrchestration";
import { useAdaptiveRuntimeRouting } from "./useAdaptiveRuntimeRouting";
import type { PendingModelSwitch, PerformanceModeApplyResult } from "./useAdaptiveRuntimeRouting";

export type { PendingModelSwitch, PerformanceModeApplyResult } from "./useAdaptiveRuntimeRouting";

const IDLE_RUNTIME_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };
const TEARDOWN_GRACE_MS = 2_000;
const DEFAULT_CONVERSATION_TASK: TaskCategory = "chat";

export interface StorageNotice {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

interface RuntimeGenerationState {
  generationId: string | null;
  conversationId: ConversationId | null;
  assistantMessageId: string | null;
}

interface AppRuntimeContextValue {
  runtimeState: RuntimeState;
  performanceMode: PerformanceMode | null;
  activeConversationTask: TaskCategory;
  routerDecision: RouterDecision | null;
  selectedModel: ModelRegistryRecord | null;
  loadedModel: ModelRegistryRecord | null;
  pendingModelSwitch: PendingModelSwitch | null;
  modelSelectionMode: ModelSelectionMode;
  manualModelId: string | null;
  isRoutingInProgress: boolean;
  isFallbackRetry: boolean;
  conversations: ConversationMetadata[];
  activeConversationId: ConversationId | null;
  messages: ChatMessageItem[];
  storageNotice: StorageNotice | null;
  generation: RuntimeGenerationState;
  isConversationSwitchBlocked: boolean;
  configureChatRoute: (task: TaskCategory | null, mode: PerformanceMode | null) => void;
  refreshConversations: () => Promise<void>;
  clearStorageNotice: () => void;
  setStorageNotice: (notice: StorageNotice | null) => void;
  startNewConversation: (task: TaskCategory) => boolean;
  selectConversation: (id: string) => Promise<boolean>;
  renameConversation: (id: string, title: string) => Promise<boolean>;
  deleteConversation: (id: string) => Promise<boolean>;
  sendMessage: (prompt: string, responseLocale: RuntimeLocale) => Promise<boolean>;
  stopGeneration: () => void;
  reloadRuntime: () => Promise<boolean>;
  recoverRuntime: () => Promise<boolean>;
  applyPerformanceMode: (mode: PerformanceMode) => Promise<PerformanceModeApplyResult>;
  confirmModelSwitch: () => Promise<void>;
  cancelModelSwitch: () => void;
  setManualModel: (modelId: string) => Promise<void>;
  setAutomaticModel: () => Promise<void>;
  clearObservations: () => Promise<void>;
  refreshRoutingDecision: () => Promise<void>;
}

const AppRuntimeContext = createContext<AppRuntimeContextValue | null>(null);

function createClientWorker(): Worker {
  return new Worker(new URL("../../workers/inference.worker.ts", import.meta.url), { type: "module" });
}

function createClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AppRuntimeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const lifecycleRef = useRef(
    createPersistentRuntimeLifecycle<InferenceRuntime, Worker>({
      createWorker: createClientWorker,
      createRuntime: createInferenceRuntime,
      teardownGraceMs: TEARDOWN_GRACE_MS,
    })
  );

  const [runtimeState, setRuntimeState] = useState<RuntimeState>(IDLE_RUNTIME_STATE);
  const [performanceMode, setPerformanceModeState] = useState<PerformanceMode | null>(null);
  const [activeConversationTask, setActiveConversationTaskState] =
    useState<TaskCategory>(DEFAULT_CONVERSATION_TASK);
  const [conversations, setConversations] = useState<ConversationMetadata[]>([]);
  const [activeConversationId, setActiveConversationIdState] = useState<ConversationId | null>(null);
  const [messages, setMessagesState] = useState<ChatMessageItem[]>([]);
  const [storageNotice, setStorageNoticeState] = useState<StorageNotice | null>(null);
  const [generation, setGenerationState] = useState<RuntimeGenerationState>({
    generationId: null,
    conversationId: null,
    assistantMessageId: null,
  });

  const runtimeStateRef = useRef(runtimeState);
  const performanceModeRef = useRef(performanceMode);
  const activeConversationTaskRef = useRef(activeConversationTask);
  const localeRef = useRef(locale);
  const activeConversationIdRef = useRef(activeConversationId);
  const messagesRef = useRef(messages);
  const activeGenerationRef = useRef<ActiveGenerationDescriptor | null>(null);
  const hasRequestedInitialRuntimeRef = useRef(false);

  const setRuntimeStateSnapshot = useCallback((next: RuntimeState) => {
    runtimeStateRef.current = next;
    setRuntimeState(next);
  }, []);

  const setPerformanceMode = useCallback((next: PerformanceMode | null) => {
    performanceModeRef.current = next;
    setPerformanceModeState(next);
  }, []);

  const setActiveConversationTask = useCallback((next: TaskCategory) => {
    activeConversationTaskRef.current = next;
    setActiveConversationTaskState(next);
  }, []);

  const setActiveConversationId = useCallback((next: ConversationId | null) => {
    activeConversationIdRef.current = next;
    setActiveConversationIdState(next);
  }, []);

  const setMessages = useCallback((updater: (previous: ChatMessageItem[]) => ChatMessageItem[]) => {
    setMessagesState((previous) => {
      const next = updater(previous);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const replaceMessages = useCallback((next: ChatMessageItem[]) => {
    messagesRef.current = next;
    setMessagesState(next);
  }, []);

  const setActiveGeneration = useCallback((next: ActiveGenerationDescriptor | null) => {
    activeGenerationRef.current = next;
    setGenerationState({
      generationId: next?.generationId ?? null,
      conversationId: next?.conversationId ?? null,
      assistantMessageId: next?.assistantMessageId ?? null,
    });
  }, []);

  const refreshConversations = useCallback(async () => {
    setConversations(await listConversations());
  }, []);

  localeRef.current = locale;

  const {
    applyModelSwitchIfNeeded,
    applyPerformanceMode,
    cancelModelSwitch,
    clearObservations,
    confirmModelSwitch,
    evaluateRouting,
    initializeRuntime,
    isFallbackRetry,
    isRoutingInProgress,
    loadedModel,
    manualModelId,
    modelSelectionMode,
    pendingModelSwitch,
    recoverRuntime,
    refreshRoutingDecision,
    reloadRuntime,
    routerDecision,
    routerDecisionRef,
    selectedModel,
    setAutomaticModel,
    setManualModel,
  } = useAdaptiveRuntimeRouting({
    lifecycleRef,
    runtimeState,
    runtimeStateRef,
    setRuntimeStateSnapshot,
    performanceMode,
    performanceModeRef,
    setPerformanceMode,
    activeConversationTask,
    activeConversationTaskRef,
    locale,
    localeRef,
  });

  useEffect(() => {
    return () => {
      lifecycleRef.current.disposeCurrent("app_root_unmount");
    };
  }, []);

  // FreeAI Open intentionally keeps generation alive while the tab is
  // backgrounded (see runtimeLifecyclePolicy.ts's "visibility_hidden" being
  // a non-disposal trigger) — but background tab throttling can delay timer
  // firing and worker message delivery in ways that look identical to a
  // genuine stall. This is the app layer's half of that: ai-runtime stays
  // platform-independent and exposes setGenerationWatchdogSuspended(), and
  // only this hook reads document.visibilityState. Suspending/resuming is a
  // no-op whenever no generation is active.
  useEffect(() => {
    function handleVisibilityChange(): void {
      lifecycleRef.current.getCurrentRuntime()?.setGenerationWatchdogSuspended(document.hidden);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [lifecycleRef]);

  useEffect(() => {
    if (performanceModeRef.current) return;
    const storedMode = getStoredPerformanceMode();
    if (storedMode) setPerformanceMode(storedMode);
  }, [pathname, setPerformanceMode]);

  useEffect(() => {
    if (!performanceMode || hasRequestedInitialRuntimeRef.current || !pathname?.startsWith("/chat")) return;
    hasRequestedInitialRuntimeRef.current = true;
    void initializeRuntime("initial");
  }, [initializeRuntime, pathname, performanceMode]);

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
      setActiveConversationTask(resolveConversationTask(conversation.task));
      replaceMessages(toChatMessageItems(conversation));
      setStoredActiveConversationId(conversation.id);
    })();

    return () => {
      cancelled = true;
    };
  }, [replaceMessages, setActiveConversationId, setActiveConversationTask]);

  useEffect(() => {
    if (runtimeState.status !== "error" || !runtimeState.error || !activeGenerationRef.current) return;

    const activeGeneration = activeGenerationRef.current;
    const errorCode = runtimeState.error.code;
    // This effect fires for watchdog-forced errors (cancel_timeout,
    // generation_stalled, generation_exceeded_safety_limit): the runtime's
    // generate() loop was abandoned mid-stream by forceRecovery() rather
    // than yielding its own "done"/"error" chunk, so sendMessage()'s own
    // completion handling never runs for these — this is the only place
    // that sees them. Whatever assistant text already streamed is still
    // sitting in React state, keyed by the active generation's message id.
    const assistantMessage = messagesRef.current.find(
      (message) => message.id === activeGeneration.assistantMessageId
    );
    const hasPartialOutput = Boolean(assistantMessage && assistantMessage.content.length > 0);
    const noticeKey = generationNoticeKey(null, errorCode, hasPartialOutput);
    const currentRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeState.modelId);
    if (currentRegistryId) {
      recordModelPerformanceObservation(
        buildGenerationObservation({
          modelId: currentRegistryId,
          stopReason: null,
          errorCode,
        })
      );
    }
    setActiveGeneration(null);
    if (shouldDiscardPartialAssistantOutput(null, errorCode, hasPartialOutput)) {
      setMessages((previous) => removeAssistantMessage(previous, activeGeneration.assistantMessageId));
    } else if (assistantMessage) {
      // A genuine watchdog interruption that already produced visible
      // output: keep it in the transcript and persist it as the (marked
      // incomplete via storageNotice) assistant reply, instead of
      // discarding legitimately-generated content the user was reading.
      void addMessage(activeGeneration.conversationId, {
        id: assistantMessage.id,
        role: "assistant",
        content: assistantMessage.content,
      }).then((saved) => {
        if (saved) void refreshConversations();
      });
    }
    if (noticeKey) setStorageNoticeState({ key: noticeKey });
    if (errorCode === "cancel_timeout") {
      void recoverRuntime();
    } else {
      void refreshRoutingDecision();
    }
  }, [
    recoverRuntime,
    refreshConversations,
    refreshRoutingDecision,
    runtimeState.error,
    runtimeState.modelId,
    runtimeState.status,
    setActiveGeneration,
    setMessages,
  ]);

  const configureChatRoute = useCallback(
    (task: TaskCategory | null, mode: PerformanceMode | null) => {
      if (task && !activeConversationIdRef.current) {
        setActiveConversationTask(task);
      }
      if (mode) {
        setPerformanceMode(mode);
        setStoredPerformanceMode(mode);
      }
    },
    [setActiveConversationTask, setPerformanceMode]
  );

  const startNewConversation = useCallback(
    (task: TaskCategory) => {
      if (isConversationSwitchBlockedStatus(runtimeStateRef.current.status)) return false;
      setStorageNoticeState(null);
      setActiveConversationId(null);
      setActiveConversationTask(task);
      replaceMessages([]);
      clearStoredActiveConversationId();
      return true;
    },
    [replaceMessages, setActiveConversationId, setActiveConversationTask]
  );

  const selectConversation = useCallback(
    async (id: string) => {
      if (isConversationSwitchBlockedStatus(runtimeStateRef.current.status)) return false;
      setStorageNoticeState(null);
      const conversation = await getConversation(id as ConversationId);
      if (!conversation) {
        setStorageNoticeState({ key: "storageNotice.couldNotLoadConversation" });
        return false;
      }

      setActiveConversationId(conversation.id);
      setActiveConversationTask(resolveConversationTask(conversation.task));
      replaceMessages(toChatMessageItems(conversation));
      setStoredActiveConversationId(conversation.id);
      return true;
    },
    [replaceMessages, setActiveConversationId, setActiveConversationTask]
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const updated = await updateConversationTitle(id as ConversationId, title);
      if (!updated) {
        setStorageNoticeState({ key: "storageNotice.couldNotRename" });
        return false;
      }
      await refreshConversations();
      return true;
    },
    [refreshConversations]
  );

  const deleteConversationById = useCallback(
    async (id: string) => {
      if (isConversationSwitchBlockedStatus(runtimeStateRef.current.status)) return false;
      const success = await deleteConversation(id as ConversationId);
      if (!success) {
        setStorageNoticeState({ key: "storageNotice.couldNotDelete" });
        return false;
      }
      if (activeConversationIdRef.current === id) {
        setActiveConversationId(null);
        setActiveConversationTask(DEFAULT_CONVERSATION_TASK);
        replaceMessages([]);
        clearStoredActiveConversationId();
      }
      await refreshConversations();
      return true;
    },
    [refreshConversations, replaceMessages, setActiveConversationId, setActiveConversationTask]
  );

  const appendAssistantText = useCallback(
    (generationId: string, conversationId: ConversationId, assistantMessageId: string, text: string) => {
      setMessages((previous) =>
        appendAssistantChunk(previous, activeGenerationRef.current, generationId, conversationId, assistantMessageId, text)
      );
    },
    [setMessages]
  );

  const sendMessage = useCallback(
    async (prompt: string, responseLocale: RuntimeLocale) => {
      const runtime = lifecycleRef.current.getCurrentRuntime();
      const trimmedPrompt = prompt.trim();
      if (!runtime || !canSendChatMessage(runtimeStateRef.current.status, trimmedPrompt)) return false;

      setStorageNoticeState(null);
      let conversationId = activeConversationIdRef.current;

      if (!conversationId) {
        const created = await createConversation({
          title: deriveConversationTitle(trimmedPrompt),
          task: activeConversationTaskRef.current,
        });
        if (!created) {
          setStorageNoticeState({ key: "storageNotice.couldNotStartConversation" });
          return false;
        }

        conversationId = created.id;
        setActiveConversationId(created.id);
        setStoredActiveConversationId(created.id);
        await refreshConversations();
      }

      const generationId = createClientId("generation");
      const userMessage: ChatMessageItem = { id: createClientId("message"), role: "user", content: trimmedPrompt };
      const assistantId = createClientId("assistant");
      setActiveGeneration({ generationId, conversationId, assistantMessageId: assistantId });
      setMessages((previous) => [...previous, userMessage, { id: assistantId, role: "assistant", content: "" }]);

      if (!(await addMessage(conversationId, { id: userMessage.id, role: "user", content: trimmedPrompt }))) {
        setStorageNoticeState({ key: "storageNotice.couldNotSaveMessage" });
      } else if (messagesRef.current.length === 2) {
        void updateConversationTitle(conversationId, deriveConversationTitle(trimmedPrompt)).then((updated) => {
          if (updated) void refreshConversations();
        });
      }

      let assistantText = "";
      let stopReason: GenerationStopReason | null = null;
      let runtimeErrorCode: RuntimeErrorCode | undefined;
      const generationStartedAt = Date.now();
      let firstTokenAt: number | null = null;
      const streamBuffer = createStreamingTextBuffer({
        onFlush: (text) => appendAssistantText(generationId, conversationId, assistantId, text),
      });

      try {
        for await (const chunk of runtime.generate({
          conversationId,
          prompt: trimmedPrompt,
          responseLocale,
          maxOutputTokens: routerDecisionRef.current?.recommendedMaxOutputTokens,
        })) {
          if (!isGenerationCurrent(activeGenerationRef.current, generationId, conversationId)) break;

          if (chunk.type === "token") {
            if (firstTokenAt === null) firstTokenAt = Date.now();
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

      if (!isGenerationCurrent(activeGenerationRef.current, generationId, conversationId)) {
        return false;
      }

      const currentRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
      if (currentRegistryId) {
        recordModelPerformanceObservation(
          buildGenerationObservation({
            modelId: currentRegistryId,
            firstTokenTimeMs: firstTokenAt !== null ? firstTokenAt - generationStartedAt : undefined,
            generationDurationMs: Date.now() - generationStartedAt,
            stopReason,
            errorCode: runtimeErrorCode,
          })
        );
        void evaluateRouting().then((decision) => applyModelSwitchIfNeeded(decision));
      }

      if (shouldDiscardPartialAssistantOutput(stopReason, runtimeErrorCode)) {
        setActiveGeneration(null);
        setMessages((previous) => removeAssistantMessage(previous, assistantId));
        const noticeKey =
          stopReason === "cancelled"
            ? "storageNotice.generationStoppedRecovering"
            : generationNoticeKey(stopReason, runtimeErrorCode);
        if (noticeKey) setStorageNoticeState({ key: noticeKey });
        if (stopReason === "cancelled") {
          await recoverRuntime();
        }
        return true;
      }

      setActiveGeneration(null);
      if (stopReason === "completed" && assistantText.length === 0) {
        setMessages((previous) => removeAssistantMessage(previous, assistantId));
        return true;
      }

      if (shouldPersistAssistantOutput(stopReason, assistantText)) {
        if (!(await addMessage(conversationId, { id: assistantId, role: "assistant", content: assistantText }))) {
          setStorageNoticeState({ key: "storageNotice.couldNotSaveReply" });
        } else {
          await refreshConversations();
        }
      }

      return true;
    },
    [
      applyModelSwitchIfNeeded,
      appendAssistantText,
      evaluateRouting,
      recoverRuntime,
      refreshConversations,
      setActiveConversationId,
      setActiveGeneration,
      setMessages,
    ]
  );

  const stopGeneration = useCallback(() => {
    lifecycleRef.current.getCurrentRuntime()?.stopGeneration();
  }, []);

  const value = useMemo<AppRuntimeContextValue>(
    () => ({
      runtimeState,
      performanceMode,
      activeConversationTask,
      routerDecision,
      selectedModel,
      loadedModel,
      pendingModelSwitch,
      modelSelectionMode,
      manualModelId,
      isRoutingInProgress,
      isFallbackRetry,
      conversations,
      activeConversationId,
      messages,
      storageNotice,
      generation,
      isConversationSwitchBlocked: isConversationSwitchBlockedStatus(runtimeState.status),
      configureChatRoute,
      refreshConversations,
      clearStorageNotice: () => setStorageNoticeState(null),
      setStorageNotice: setStorageNoticeState,
      startNewConversation,
      selectConversation,
      renameConversation,
      deleteConversation: deleteConversationById,
      sendMessage,
      stopGeneration,
      reloadRuntime,
      recoverRuntime,
      applyPerformanceMode,
      confirmModelSwitch,
      cancelModelSwitch,
      setManualModel,
      setAutomaticModel,
      clearObservations,
      refreshRoutingDecision,
    }),
    [
      activeConversationId,
      activeConversationTask,
      applyPerformanceMode,
      cancelModelSwitch,
      clearObservations,
      configureChatRoute,
      confirmModelSwitch,
      conversations,
      deleteConversationById,
      generation,
      isFallbackRetry,
      isRoutingInProgress,
      loadedModel,
      manualModelId,
      messages,
      modelSelectionMode,
      pendingModelSwitch,
      performanceMode,
      recoverRuntime,
      refreshConversations,
      refreshRoutingDecision,
      reloadRuntime,
      renameConversation,
      routerDecision,
      runtimeState,
      selectConversation,
      selectedModel,
      sendMessage,
      setAutomaticModel,
      setManualModel,
      startNewConversation,
      stopGeneration,
      storageNotice,
    ]
  );

  return <AppRuntimeContext.Provider value={value}>{children}</AppRuntimeContext.Provider>;
}

export function useAppRuntime(): AppRuntimeContextValue {
  const context = useContext(AppRuntimeContext);
  if (!context) throw new Error("useAppRuntime must be used within AppRuntimeProvider");
  return context;
}

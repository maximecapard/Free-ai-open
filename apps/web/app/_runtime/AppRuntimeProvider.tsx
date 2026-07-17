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
import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { sampleModels } from "@free-ai-open/model-registry";
import { selectRecommendedModel } from "@free-ai-open/model-router";
import type { ModelRouterResult } from "@free-ai-open/model-router";
import type { PerformanceMode, TaskCategory } from "@free-ai-open/types";
import type { ChatMessageItem } from "../_components/ChatTranscript";
import type { TranslationKey } from "../_i18n/dictionary";
import {
  clearStoredActiveConversationId,
  getStoredActiveConversationId,
  setStoredActiveConversationId,
} from "../_lib/activeConversationStorage";
import { deriveConversationTitle, toChatMessageItems } from "../_lib/conversationMessages";
import {
  generationNoticeKey,
  shouldDiscardPartialAssistantOutput,
  shouldPersistAssistantOutput,
} from "../_lib/generationPersistence";
import { getStoredPerformanceMode, setStoredPerformanceMode } from "../_lib/gettingStartedPreference";
import {
  doesPerformanceModeRequireRuntimeReplacement,
  resolvePerformanceModeChange,
} from "../_lib/performanceModeRuntimePolicy";
import {
  appendAssistantChunk,
  isGenerationCurrent,
  removeAssistantMessage,
  type ActiveGenerationDescriptor,
} from "../_lib/persistentGenerationState";
import { recordRuntimeRecoveryEvent } from "../_lib/runtimeRecovery";
import { canSendChatMessage, isConversationSwitchBlockedStatus } from "../_lib/runtimeUiState";
import { createStreamingTextBuffer } from "../_lib/streamingBuffer";
import { resolveConversationTask } from "../_lib/catalog";
import { createPersistentRuntimeLifecycle } from "./persistentRuntimeLifecycle";

const IDLE_RUNTIME_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };
const TEARDOWN_GRACE_MS = 2_000;
const DEFAULT_CONVERSATION_TASK: TaskCategory = "chat";

export interface StorageNotice {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

export interface PerformanceModeApplyResult {
  ok: boolean;
  replacedRuntime: boolean;
  blockedReason?: "active_generation";
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
  routeResult: ModelRouterResult | null;
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
  const [routeResult, setRouteResult] = useState<ModelRouterResult | null>(null);
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
  const activeConversationIdRef = useRef(activeConversationId);
  const messagesRef = useRef(messages);
  const activeGenerationRef = useRef<ActiveGenerationDescriptor | null>(null);
  const runtimeLoadEpochRef = useRef(0);
  const recoveryInProgressRef = useRef(false);
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

  const initializeRuntime = useCallback(
    async (reason: "initial" | "explicit_reload" | "performance_replacement" | "recovery" = "initial") => {
      if (reason !== "recovery" && isConversationSwitchBlockedStatus(runtimeStateRef.current.status)) {
        return false;
      }

      const lifecycle = lifecycleRef.current;
      if (reason === "initial" && lifecycle.hasRuntime()) return true;

      const runtimeLoadEpoch = ++runtimeLoadEpochRef.current;
      const isRecovery = reason === "recovery";
      if (isRecovery) {
        recordRuntimeRecoveryEvent("runtime.recovery.started", "info", "recovering");
      }

      const instance =
        reason === "initial"
          ? lifecycle.ensureRuntime(setRuntimeStateSnapshot)
          : lifecycle.replaceRuntime(
              reason === "explicit_reload"
                ? "explicit_reload"
                : reason === "performance_replacement"
                  ? "performance_replacement"
                  : "recovery",
              setRuntimeStateSnapshot
            );

      setRuntimeStateSnapshot(
        isRecovery ? { status: "recovering", modelId: null, loadProgress: 0, error: null } : instance.runtime.getState()
      );

      try {
        await instance.runtime.loadModel(undefined, { initialStatus: isRecovery ? "recovering" : "loading_model" });
      } catch {
        if (runtimeLoadEpoch === runtimeLoadEpochRef.current && lifecycle.getCurrentRuntime() === instance.runtime) {
          setRuntimeStateSnapshot({
            status: "error",
            modelId: instance.runtime.getState().modelId,
            loadProgress: instance.runtime.getState().loadProgress,
            error: { code: "unknown", message: "Runtime initialization failed." },
          });
          if (isRecovery) {
            recordRuntimeRecoveryEvent("runtime.recovery.failed", "error", "error", "RUNTIME_RECOVERY_FAILED");
          }
        }
        return true;
      }

      if (runtimeLoadEpoch !== runtimeLoadEpochRef.current || lifecycle.getCurrentRuntime() !== instance.runtime) {
        return true;
      }

      const nextState = instance.runtime.getState();
      setRuntimeStateSnapshot(nextState);
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

      return true;
    },
    [setRuntimeStateSnapshot]
  );

  const recoverRuntime = useCallback(async () => {
    if (recoveryInProgressRef.current) return false;
    recoveryInProgressRef.current = true;
    try {
      return await initializeRuntime("recovery");
    } finally {
      recoveryInProgressRef.current = false;
    }
  }, [initializeRuntime]);

  const reloadRuntime = useCallback(async () => initializeRuntime("explicit_reload"), [initializeRuntime]);

  useEffect(() => {
    return () => {
      lifecycleRef.current.disposeCurrent("app_root_unmount");
    };
  }, []);

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
    if (!performanceMode) return;
    let cancelled = false;

    detectDeviceProfile().then((deviceProfile) => {
      if (cancelled) return;

      const result = selectRecommendedModel({
        task: activeConversationTask,
        performanceMode,
        deviceProfile,
        modelRegistry: sampleModels,
      });

      setRouteResult(result);
      logEvent(
        createLogEvent("router_decision", "info", {
          task: activeConversationTask,
          performanceMode,
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
  }, [activeConversationTask, performanceMode]);

  useEffect(() => {
    if (runtimeState.status !== "error" || !runtimeState.error || !activeGenerationRef.current) return;

    const activeGeneration = activeGenerationRef.current;
    const noticeKey = generationNoticeKey(null, runtimeState.error.code);
    setActiveGeneration(null);
    setMessages((previous) => removeAssistantMessage(previous, activeGeneration.assistantMessageId));
    if (noticeKey) setStorageNoticeState({ key: noticeKey });
    if (runtimeState.error.code === "cancel_timeout") {
      void recoverRuntime();
    }
  }, [recoverRuntime, runtimeState.error, runtimeState.status, setActiveGeneration, setMessages]);

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
      const streamBuffer = createStreamingTextBuffer({
        onFlush: (text) => appendAssistantText(generationId, conversationId, assistantId, text),
      });

      try {
        for await (const chunk of runtime.generate({ conversationId, prompt: trimmedPrompt, responseLocale })) {
          if (!isGenerationCurrent(activeGenerationRef.current, generationId, conversationId)) break;

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

      if (!isGenerationCurrent(activeGenerationRef.current, generationId, conversationId)) {
        return false;
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
      appendAssistantText,
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

  const applyPerformanceMode = useCallback(
    async (nextMode: PerformanceMode): Promise<PerformanceModeApplyResult> => {
      const replacementRequired = doesPerformanceModeRequireRuntimeReplacement(performanceModeRef.current, nextMode);
      const decision = resolvePerformanceModeChange({
        currentMode: performanceModeRef.current,
        nextMode,
        runtimeStatus: runtimeStateRef.current.status,
        runtimeLoaded: lifecycleRef.current.hasRuntime(),
        replacementRequired,
      });

      if (decision.type === "noop") {
        return { ok: true, replacedRuntime: false };
      }

      if (decision.type === "blocked_active_generation") {
        return { ok: false, replacedRuntime: false, blockedReason: "active_generation" };
      }

      if (decision.type === "replace_runtime") {
        const replaced = await initializeRuntime("performance_replacement");
        if (!replaced) return { ok: false, replacedRuntime: false, blockedReason: "active_generation" };
      }

      setStoredPerformanceMode(nextMode);
      setPerformanceMode(nextMode);
      return { ok: true, replacedRuntime: decision.type === "replace_runtime" };
    },
    [initializeRuntime, setPerformanceMode]
  );

  const value = useMemo<AppRuntimeContextValue>(
    () => ({
      runtimeState,
      performanceMode,
      activeConversationTask,
      routeResult,
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
    }),
    [
      activeConversationId,
      activeConversationTask,
      applyPerformanceMode,
      configureChatRoute,
      conversations,
      deleteConversationById,
      generation,
      messages,
      performanceMode,
      recoverRuntime,
      refreshConversations,
      reloadRuntime,
      renameConversation,
      routeResult,
      runtimeState,
      selectConversation,
      sendMessage,
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

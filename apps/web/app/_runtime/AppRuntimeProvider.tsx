"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_MODEL_ID, createInferenceRuntime, isModelCached } from "@free-ai-open/ai-runtime";
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
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import { routeAdaptiveModel } from "@free-ai-open/model-router";
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
import { isModelSwitchBlockedStatus, resolveModelSwitch } from "../_lib/modelSwitchPolicy";
import { getStoredModelPerformanceObservations, recordModelPerformanceObservation } from "../_lib/modelObservationStore";
import { buildGenerationObservation, isModelRepeatedlyFailing } from "../_lib/performanceObservationBuilder";
import { isPerformanceModeChangeBlockedStatus } from "../_lib/performanceModeRuntimePolicy";
import { buildRoutingCacheKey, shouldRecomputeRouterDecision } from "../_lib/routingDecisionCache";
import {
  appendAssistantChunk,
  isGenerationCurrent,
  removeAssistantMessage,
  type ActiveGenerationDescriptor,
} from "../_lib/persistentGenerationState";
import { recordRuntimeRecoveryEvent } from "../_lib/runtimeRecovery";
import { canSendChatMessage, isConversationSwitchBlockedStatus } from "../_lib/runtimeUiState";
import { createStreamingTextBuffer } from "../_lib/streamingBuffer";
import { createPersistentRuntimeLifecycle } from "./persistentRuntimeLifecycle";
import {
  buildLoadCandidatesFromDecision,
  buildRouterInputContext,
  attemptModelLoadWithFallback,
  registryIdForWebllmModelId,
} from "./routingOrchestration";
import type { ModelLoadCandidate } from "./routingOrchestration";

const IDLE_RUNTIME_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };
const TEARDOWN_GRACE_MS = 2_000;
const DEFAULT_CONVERSATION_TASK: TaskCategory = "chat";

// The v0.6.6 default model already has an existing, disclosed first-run
// download flow (Getting Started) predating the adaptive router — routing to
// it never needs a *new* consent prompt. Falls back to the raw WebLLM ID
// itself if the registry is ever missing the pairing (should not happen; the
// registry is validated to include it), so a fallback candidate is never
// left with an empty registry ID.
const PRE_DISCLOSED_DEFAULT_MODEL_ID =
  modelRegistryV2.find((record) => record.webllmModelId === DEFAULT_MODEL_ID)?.id ?? DEFAULT_MODEL_ID;
const DEFAULT_LOAD_CANDIDATE: ModelLoadCandidate = {
  registryId: PRE_DISCLOSED_DEFAULT_MODEL_ID,
  webllmModelId: DEFAULT_MODEL_ID,
};

export interface StorageNotice {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

export interface PerformanceModeApplyResult {
  ok: boolean;
  replacedRuntime: boolean;
  blockedReason?: "active_generation";
}

export interface PendingModelSwitch {
  registryId: string;
  webllmModelId: string;
  displayName: string;
  descriptionKey: TranslationKey;
  downloadSizeBytes?: number;
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
  pendingModelSwitch: PendingModelSwitch | null;
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

function toPendingModelSwitch(record: ModelRegistryRecord): PendingModelSwitch {
  return {
    registryId: record.id,
    webllmModelId: record.webllmModelId,
    displayName: record.displayName,
    descriptionKey: record.descriptionKey as TranslationKey,
    downloadSizeBytes: record.downloadSize.value,
  };
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
  const [routerDecision, setRouterDecisionState] = useState<RouterDecision | null>(null);
  const [pendingModelSwitch, setPendingModelSwitchState] = useState<PendingModelSwitch | null>(null);
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
  const routerDecisionRef = useRef<RouterDecision | null>(null);
  const routingCacheKeyRef = useRef<string | null>(null);
  const activeGenerationRef = useRef<ActiveGenerationDescriptor | null>(null);
  const runtimeLoadEpochRef = useRef(0);
  const recoveryInProgressRef = useRef(false);
  const hasRequestedInitialRuntimeRef = useRef(false);
  const isFirstRoutingEffectRef = useRef(true);

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

  const setRouterDecision = useCallback((next: RouterDecision | null) => {
    routerDecisionRef.current = next;
    setRouterDecisionState(next);
  }, []);

  const refreshConversations = useCallback(async () => {
    setConversations(await listConversations());
  }, []);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  // Builds fresh router input from current task/locale/mode plus stored
  // capability/benchmark/observation data, and asks the adaptive router for a
  // decision — but only when something routing-relevant actually changed
  // since the last call (see routingDecisionCache.ts). Returns the current
  // (possibly reused) decision, or null if no capability profile could be
  // produced at all (the caller falls back to v0.6.6 default-model behavior).
  const evaluateRouting = useCallback(async (): Promise<RouterDecision | null> => {
    const mode = performanceModeRef.current;
    if (!mode) return routerDecisionRef.current;

    const routerInput = await buildRouterInputContext({
      task: activeConversationTaskRef.current,
      locale: localeRef.current,
      performanceMode: mode,
    });

    if (!routerInput) {
      setRouterDecision(null);
      routingCacheKeyRef.current = null;
      return null;
    }

    const currentRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
    const cacheKey = buildRoutingCacheKey({
      task: routerInput.task,
      locale: routerInput.locale,
      performanceMode: routerInput.performanceMode,
      capabilityDetectedAt: routerInput.capability.detectedAt,
      benchmarkMeasuredAt: routerInput.benchmark?.measuredAt,
      manualModelId: routerInput.manualModelId,
      cachedModelIds: routerInput.cachedModelIds,
      registryVersion: routerInput.registryVersion,
      currentModelRepeatedlyFailing: currentRegistryId
        ? isModelRepeatedlyFailing(routerInput.observations, currentRegistryId)
        : false,
    });

    if (!shouldRecomputeRouterDecision(routingCacheKeyRef.current, cacheKey)) {
      return routerDecisionRef.current;
    }

    routingCacheKeyRef.current = cacheKey;
    const decision = routeAdaptiveModel(routerInput);
    setRouterDecision(decision);
    logEvent(
      createLogEvent("router_decision", "info", {
        task: routerInput.task,
        performanceMode: routerInput.performanceMode,
        selectedModelId: decision.selectedModelId,
        fallbackModelIds: decision.fallbackModelIds,
        reasonCodes: decision.reasons,
        warningCodes: decision.warnings,
        rejectedCount: decision.rejectedModels.length,
        confidence: decision.confidence,
      })
    );
    return decision;
  }, [setRouterDecision]);

  // First-ever load only: decides whether the router's pick can be loaded
  // immediately (cached, or the already-disclosed default) or whether the
  // user must be asked first — in which case the disclosed default loads
  // right away so chat isn't blocked, and confirming the prompt later safely
  // upgrades to the router's real recommendation via performModelSwitch.
  const resolveInitialLoadCandidates = useCallback(
    async (decision: RouterDecision | null): Promise<ModelLoadCandidate[]> => {
      const selectedRecord = decision?.selectedModelId
        ? modelRegistryV2.find((record) => record.id === decision.selectedModelId)
        : undefined;
      if (!decision || !selectedRecord) return [DEFAULT_LOAD_CANDIDATE];

      const cached = await isModelCached(selectedRecord.webllmModelId);
      const switchDecision = resolveModelSwitch({
        currentModelId: null,
        selectedModelId: selectedRecord.id,
        runtimeStatus: "idle",
        isCached: cached,
        isPreDisclosedDefault: selectedRecord.id === PRE_DISCLOSED_DEFAULT_MODEL_ID,
      });

      if (switchDecision.type === "needs_consent") {
        setPendingModelSwitchState(toPendingModelSwitch(selectedRecord));
        return [DEFAULT_LOAD_CANDIDATE];
      }

      return buildLoadCandidatesFromDecision(modelRegistryV2, [decision.selectedModelId, ...decision.fallbackModelIds]);
    },
    []
  );

  const initializeRuntime = useCallback(
    async (
      reason: "initial" | "explicit_reload" | "performance_replacement" | "recovery" | "model_replacement" = "initial",
      explicitCandidates?: ModelLoadCandidate[]
    ) => {
      const busyBlocked =
        reason === "model_replacement"
          ? isModelSwitchBlockedStatus(runtimeStateRef.current.status)
          : reason !== "recovery" && isConversationSwitchBlockedStatus(runtimeStateRef.current.status);
      if (busyBlocked) return false;

      const lifecycle = lifecycleRef.current;
      if (reason === "initial" && lifecycle.hasRuntime()) return true;

      const runtimeLoadEpoch = ++runtimeLoadEpochRef.current;
      const isRecovery = reason === "recovery";
      if (isRecovery) {
        recordRuntimeRecoveryEvent("runtime.recovery.started", "info", "recovering");
      }

      const instance = reason === "initial" ? lifecycle.ensureRuntime(setRuntimeStateSnapshot) : lifecycle.replaceRuntime(reason, setRuntimeStateSnapshot);

      setRuntimeStateSnapshot(
        isRecovery ? { status: "recovering", modelId: null, loadProgress: 0, error: null } : instance.runtime.getState()
      );

      let candidates = explicitCandidates;
      if (!candidates) {
        const decision =
          reason === "initial" || !routerDecisionRef.current ? await evaluateRouting() : routerDecisionRef.current;

        if (runtimeLoadEpoch !== runtimeLoadEpochRef.current || lifecycle.getCurrentRuntime() !== instance.runtime) {
          return true;
        }

        candidates =
          reason === "initial"
            ? await resolveInitialLoadCandidates(decision)
            : decision?.selectedModelId
              ? buildLoadCandidatesFromDecision(modelRegistryV2, [decision.selectedModelId, ...decision.fallbackModelIds])
              : [];

        if (candidates.length === 0) candidates = [DEFAULT_LOAD_CANDIDATE];
      }

      if (runtimeLoadEpoch !== runtimeLoadEpochRef.current || lifecycle.getCurrentRuntime() !== instance.runtime) {
        return true;
      }

      try {
        await attemptModelLoadWithFallback(instance.runtime, candidates, {
          initialStatus: isRecovery ? "recovering" : "loading_model",
        });
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
    [evaluateRouting, resolveInitialLoadCandidates, setRuntimeStateSnapshot]
  );

  // Actually performs a safe model swap: replaces the persistent runtime's
  // worker/engine and loads the decision's selected model (falling through
  // its fallback chain on failure). Never called while generation is active —
  // callers must have already confirmed that via resolveModelSwitch.
  const performModelSwitch = useCallback(
    async (decision: RouterDecision) => {
      const candidates = buildLoadCandidatesFromDecision(modelRegistryV2, [
        decision.selectedModelId,
        ...decision.fallbackModelIds,
      ]);
      if (candidates.length === 0) return;
      await initializeRuntime("model_replacement", candidates);
    },
    [initializeRuntime]
  );

  // Resolves what (if anything) must happen when a decision's selected model
  // differs from what is currently loaded: switch immediately (cached or the
  // pre-disclosed default), ask first (a fresh, non-default download), or
  // silently defer (runtime busy — the next routing moment retries this).
  const applyModelSwitchIfNeeded = useCallback(
    async (decision: RouterDecision | null) => {
      if (!decision?.selectedModelId) return;
      if (!lifecycleRef.current.hasRuntime()) return;

      const selectedRecord = modelRegistryV2.find((record) => record.id === decision.selectedModelId);
      if (!selectedRecord) return;

      const currentRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
      if (currentRegistryId === selectedRecord.id) {
        setPendingModelSwitchState(null);
        return;
      }

      const cached = await isModelCached(selectedRecord.webllmModelId);
      const switchDecision = resolveModelSwitch({
        currentModelId: currentRegistryId,
        selectedModelId: selectedRecord.id,
        runtimeStatus: runtimeStateRef.current.status,
        isCached: cached,
        isPreDisclosedDefault: selectedRecord.id === PRE_DISCLOSED_DEFAULT_MODEL_ID,
      });

      if (switchDecision.type === "switch_now") {
        setPendingModelSwitchState(null);
        await performModelSwitch(decision);
        return;
      }

      if (switchDecision.type === "needs_consent") {
        setPendingModelSwitchState(toPendingModelSwitch(selectedRecord));
      }
      // "blocked_active_generation": leave things as-is; the next routing
      // moment (e.g. right after the current generation finishes) retries.
    },
    [performModelSwitch]
  );

  const confirmModelSwitch = useCallback(async () => {
    if (!pendingModelSwitch) return;
    setPendingModelSwitchState(null);
    const decision = routerDecisionRef.current;
    if (decision?.selectedModelId === pendingModelSwitch.registryId) {
      await performModelSwitch(decision);
    }
  }, [pendingModelSwitch, performModelSwitch]);

  const cancelModelSwitch = useCallback(() => {
    setPendingModelSwitchState(null);
  }, []);

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

  // Re-evaluates routing whenever a "routing moment" the mission calls out
  // occurs — task, performance mode, or locale changes. Skips its very first
  // firing: that one coincides with the initial-runtime-bootstrap effect
  // above, which already computes the first decision itself (avoids two
  // concurrent evaluations racing on mount).
  useEffect(() => {
    if (!performanceMode) return;
    if (isFirstRoutingEffectRef.current) {
      isFirstRoutingEffectRef.current = false;
      return;
    }

    let cancelled = false;
    (async () => {
      const decision = await evaluateRouting();
      if (cancelled) return;
      await applyModelSwitchIfNeeded(decision);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeConversationTask, applyModelSwitchIfNeeded, evaluateRouting, locale, performanceMode]);

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
            testedContextTokens: routerDecisionRef.current?.recommendedContextTokens,
            stopReason,
            errorCode: runtimeErrorCode,
          })
        );

        if (isModelRepeatedlyFailing(getStoredModelPerformanceObservations(), currentRegistryId)) {
          void evaluateRouting().then((decision) => applyModelSwitchIfNeeded(decision));
        } else {
          void applyModelSwitchIfNeeded(routerDecisionRef.current);
        }
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

  const applyPerformanceMode = useCallback(
    async (nextMode: PerformanceMode): Promise<PerformanceModeApplyResult> => {
      if (performanceModeRef.current === nextMode) {
        return { ok: true, replacedRuntime: false };
      }
      if (isPerformanceModeChangeBlockedStatus(runtimeStateRef.current.status)) {
        return { ok: false, replacedRuntime: false, blockedReason: "active_generation" };
      }

      const previousRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
      setStoredPerformanceMode(nextMode);
      setPerformanceMode(nextMode);

      const decision = await evaluateRouting();
      if (decision) await applyModelSwitchIfNeeded(decision);

      const nextRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
      return { ok: true, replacedRuntime: lifecycleRef.current.hasRuntime() && nextRegistryId !== previousRegistryId };
    },
    [applyModelSwitchIfNeeded, evaluateRouting, setPerformanceMode]
  );

  const selectedModel = useMemo<ModelRegistryRecord | null>(
    () => (routerDecision?.selectedModelId ? modelRegistryV2.find((record) => record.id === routerDecision.selectedModelId) ?? null : null),
    [routerDecision]
  );

  const value = useMemo<AppRuntimeContextValue>(
    () => ({
      runtimeState,
      performanceMode,
      activeConversationTask,
      routerDecision,
      selectedModel,
      pendingModelSwitch,
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
    }),
    [
      activeConversationId,
      activeConversationTask,
      applyPerformanceMode,
      cancelModelSwitch,
      configureChatRoute,
      confirmModelSwitch,
      conversations,
      deleteConversationById,
      generation,
      messages,
      pendingModelSwitch,
      performanceMode,
      recoverRuntime,
      refreshConversations,
      reloadRuntime,
      renameConversation,
      routerDecision,
      runtimeState,
      selectConversation,
      selectedModel,
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

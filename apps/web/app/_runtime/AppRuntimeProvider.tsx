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
  updateMessageContent,
} from "@free-ai-open/conversation-store";
import type { ConversationId, ConversationMetadata, MessageIncompleteReason, MessageStatus } from "@free-ai-open/conversation-store";
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
import { isMessageContinuable } from "../_lib/continuationEligibility";
import { runContinuationAttempt } from "../_lib/continuationExecution";
import { mergeContinuationOverlap } from "../_lib/continuationMerge";
import { buildContinuationPrompt } from "../_lib/continuationPrompt";
import { deriveConversationTitle, toChatMessageItems } from "../_lib/conversationMessages";
import { computeBudgetedOutputTokens } from "../_lib/generationBudget";
import {
  generationNoticeKey,
  incompleteReasonFor,
  isIncompleteAssistantOutput,
  shouldDiscardPartialAssistantOutput,
  shouldPersistAssistantOutput,
} from "../_lib/generationPersistence";
import { getStoredPerformanceMode, setStoredPerformanceMode } from "../_lib/gettingStartedPreference";
import type { ModelSelectionMode } from "../_lib/manualModelPreference";
import { recordModelPerformanceObservation } from "../_lib/modelObservationStore";
import { buildGenerationObservation } from "../_lib/performanceObservationBuilder";
import {
  isGenerationCurrent,
  removeAssistantMessage,
  setAssistantContent,
  type ActiveGenerationDescriptor,
} from "../_lib/persistentGenerationState";
import { canSendChatMessage, isConversationSwitchBlockedStatus } from "../_lib/runtimeUiState";
import { createStreamingTextBuffer } from "../_lib/streamingBuffer";
import { runRecoveryAction, runWatchdogRecovery } from "../_lib/watchdogRecovery";
import { createPersistentRuntimeLifecycle } from "./persistentRuntimeLifecycle";
import { registryIdForWebllmModelId } from "./routingOrchestration";
import { useAdaptiveRuntimeRouting } from "./useAdaptiveRuntimeRouting";
import type { PendingModelSwitch, PerformanceModeApplyResult } from "./useAdaptiveRuntimeRouting";

export type { PendingModelSwitch, PerformanceModeApplyResult } from "./useAdaptiveRuntimeRouting";

const IDLE_RUNTIME_STATE: RuntimeState = { status: "idle", modelId: null, loadProgress: 0, error: null };
const TEARDOWN_GRACE_MS = 2_000;
const DEFAULT_CONVERSATION_TASK: TaskCategory = "chat";
// A manual Continue click is preferable to an invisible automatic retry
// (v0.7.1-alpha) -- this still bounds how many times any one message can be
// continued, so a model that keeps hitting its output limit cannot be
// clicked into an effectively unbounded loop. The count that enforces this
// is durable (ChatMessageItem.continuationCount, persisted through
// @free-ai-open/conversation-store) rather than an in-memory ref, so a page
// refresh cannot reset the bound.
const MAX_CONTINUATIONS_PER_MESSAGE = 3;

export interface StorageNotice {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

interface RuntimeGenerationState {
  generationId: string | null;
  conversationId: ConversationId | null;
  assistantMessageId: string | null;
}

// The generation pipeline's own authoritative record of what an in-flight
// generation has produced, updated synchronously the instant a raw token
// chunk arrives -- BEFORE any buffered UI rendering and independent of
// whatever React's `messages` state happens to already reflect at that
// moment (see docs/architecture.md's "Generation output is independent from
// queued React state" section). Every persistence decision (success,
// watchdog-forced interruption, or transactional rollback) reads from this
// accumulator, never from re-reading `messagesRef.current` after the fact.
interface GenerationAccumulator {
  generationId: string;
  conversationId: ConversationId;
  assistantMessageId: string;
  // Exactly what the message contained immediately before this attempt
  // started -- "" for a fresh sendMessage, the existing partial reply for a
  // continuation. This is the transactional rollback point: if this attempt
  // must be discarded (Stop, cancel_timeout, degenerate output), the
  // message reverts to exactly this, never to whatever partial new text
  // happened to stream in first.
  priorContent: string;
  priorStatus: MessageStatus | undefined;
  priorIncompleteReason: MessageIncompleteReason | undefined;
  // The continuation count already durably persisted before this attempt
  // (0 for a fresh sendMessage). See continueGeneration()'s early,
  // synchronously-awaited persist of priorContinuationCount + 1 before any
  // token is requested -- so the attempt is durably "used" even if this
  // attempt itself is later rolled back.
  priorContinuationCount: number;
  isContinuation: boolean;
  // Raw text produced by THIS attempt only, accumulated verbatim as chunks
  // arrive (before overlap removal).
  generatedDelta: string;
  // priorContent merged with generatedDelta, with any exact continuation
  // overlap removed (see continuationMerge.ts) -- this is the value shown
  // in the UI and, on a successful/preserved outcome, persisted.
  mergedContent: string;
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
  // True only when the most recent assistant message is interrupted
  // mid-reasoning (an open <think> block with generation no longer active)
  // and has not already been continued MAX_CONTINUATIONS_PER_MESSAGE times.
  canContinueGeneration: boolean;
  continueGeneration: () => Promise<boolean>;
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
  // The single in-flight (or just-finished) generation's authoritative
  // record -- see GenerationAccumulator's own doc comment above. Both this
  // and activeGenerationRef are set together at the start of every
  // generation attempt, so the watchdog-error effect below can always read
  // it whenever activeGenerationRef.current is set.
  const generationAccumulatorRef = useRef<GenerationAccumulator | null>(null);

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
    if (!next) generationAccumulatorRef.current = null;
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

  // Fallback path for a watchdog-forced runtime error (cancel_timeout,
  // generation_stalled, generation_exceeded_safety_limit) whose generate()
  // call never delivers its own terminal chunk -- see runtime.ts's
  // forceRecovery(). Reads generationAccumulatorRef (never re-derives
  // content from messagesRef) so the persisted outcome always matches
  // exactly what this generation actually produced, and implements the
  // transactional Continue rollback: cancel_timeout during a continuation
  // reverts the message to its pre-continuation content/status instead of
  // discarding it (the message already held a legitimate prior answer) or
  // keeping possibly-corrupted new output.
  useEffect(() => {
    if (runtimeState.status !== "error" || !runtimeState.error || !activeGenerationRef.current) return;

    const activeGeneration = activeGenerationRef.current;
    const errorCode = runtimeState.error.code;
    const acc = generationAccumulatorRef.current;
    const isContinuation = acc?.isContinuation ?? false;
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

    const currentContent =
      acc?.mergedContent ?? messagesRef.current.find((message) => message.id === activeGeneration.assistantMessageId)?.content ?? "";
    const hasNewOutput = acc ? acc.generatedDelta.length > 0 : currentContent.length > 0;

    // The actual persistence decision (revert/discard/preserve) lives in
    // watchdogRecovery.ts's runWatchdogRecovery(), extracted so it can be
    // exercised directly in a test without mounting React and without a
    // real 15-second cancel-timeout hang (see watchdogRecovery.test.ts).
    void runWatchdogRecovery({
      conversationId: activeGeneration.conversationId,
      assistantMessageId: activeGeneration.assistantMessageId,
      errorCode,
      isContinuation,
      priorContent: acc?.priorContent ?? "",
      priorStatus: acc?.priorStatus,
      priorIncompleteReason: acc?.priorIncompleteReason,
      priorContinuationCount: acc?.priorContinuationCount ?? 0,
      currentContent,
      hasNewOutput,
    }).then((outcome) => {
      if (outcome.messageUpdate.op === "remove") {
        setMessages((previous) => removeAssistantMessage(previous, activeGeneration.assistantMessageId));
      } else {
        const { content, status, incompleteReason } = outcome.messageUpdate;
        setMessages((previous) =>
          previous.map((message) =>
            message.id === activeGeneration.assistantMessageId ? { ...message, content, status, incompleteReason } : message
          )
        );
      }

      if (outcome.noticeKey) setStorageNoticeState({ key: outcome.noticeKey });
      if (outcome.messageUpdate.op === "set") {
        // A persistence failure (or a successful-but-truncated write)
        // overrides the generic notice above, matching the pre-extraction
        // behavior where these were set asynchronously, after the generic
        // notice had already been applied synchronously.
        if (!outcome.persisted) {
          setStorageNoticeState({ key: "storageNotice.couldNotSaveReply" });
        } else {
          if (outcome.truncated) setStorageNoticeState({ key: "storageNotice.generationTruncatedForStorage" });
          void refreshConversations();
        }
      }

      void runRecoveryAction(outcome.recoveryAction, { recoverRuntime, refreshRoutingDecision }).then((recoveryResult) => {
        // The most specific, latest-arriving signal wins -- matching the
        // existing "async notice overrides the generic one" convention just
        // above -- since recoverRuntime() failing means the local model is
        // not actually usable again yet, which is more urgent than whatever
        // the persistence-outcome notice already said.
        if (!recoveryResult.recoverySucceeded) {
          setStorageNoticeState({ key: "storageNotice.runtimeRecoveryFailed" });
        }
      });
    });
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

  // Applies one raw chunk to the accumulator synchronously (runtime chunk ->
  // accumulator, before any buffered UI rendering, in the raw-chunk loops
  // below -- this function only ever REFLECTS the accumulator's current
  // mergedContent into React state; it never mutates the accumulator
  // itself. The buffered flush this is called from batches RENDER TIMING
  // only -- the actual content it writes always comes from the
  // accumulator, never from re-appending onto whatever `messages` state
  // happens to already hold (see GenerationAccumulator's doc comment
  // above and docs/architecture.md's "Generation output is independent
  // from queued React state" section).
  const flushAccumulatorToMessages = useCallback(
    (generationId: string, conversationId: ConversationId, assistantMessageId: string) => {
      const acc = generationAccumulatorRef.current;
      const content = acc && acc.generationId === generationId ? acc.mergedContent : "";
      setMessages((previous) => setAssistantContent(previous, activeGenerationRef.current, generationId, conversationId, assistantMessageId, content));
    },
    [setMessages]
  );

  const sendMessage = useCallback(
    async (prompt: string, responseLocale: RuntimeLocale) => {
      const runtime = lifecycleRef.current.getCurrentRuntime();
      const trimmedPrompt = prompt.trim();
      if (!runtime || !canSendChatMessage(runtimeStateRef.current.status, trimmedPrompt)) return false;

      setStorageNoticeState(null);

      const { maxOutputTokens, insufficientContext } = computeBudgetedOutputTokens(
        routerDecisionRef.current,
        responseLocale,
        trimmedPrompt
      );
      if (insufficientContext) {
        setStorageNoticeState({ key: "storageNotice.generationContextTooLong" });
        return false;
      }

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
      generationAccumulatorRef.current = {
        generationId,
        conversationId,
        assistantMessageId: assistantId,
        priorContent: "",
        priorStatus: undefined,
        priorIncompleteReason: undefined,
        priorContinuationCount: 0,
        isContinuation: false,
        generatedDelta: "",
        mergedContent: "",
      };
      setActiveGeneration({ generationId, conversationId, assistantMessageId: assistantId });
      setMessages((previous) => [...previous, userMessage, { id: assistantId, role: "assistant", content: "" }]);

      const savedUserMessage = await addMessage(conversationId, { id: userMessage.id, role: "user", content: trimmedPrompt });
      if (!savedUserMessage) {
        setStorageNoticeState({ key: "storageNotice.couldNotSaveMessage" });
      } else {
        // Item 10: a pasted message long enough to exceed the local 64k
        // storage ceiling is truncated by the store rather than rejected --
        // surface that rather than silently keeping only part of what the
        // user actually sent.
        if (savedUserMessage.truncated) {
          setStorageNoticeState({ key: "storageNotice.messageTruncatedForStorage" });
          // Item 4: adopt the store's own normalized message so the visible
          // bubble can never keep showing more than what was actually saved.
          const savedUserRecord = savedUserMessage.conversation.messages.find((message) => message.id === userMessage.id);
          if (savedUserRecord) {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === userMessage.id
                  ? { ...message, content: savedUserRecord.content, status: savedUserRecord.status, incompleteReason: savedUserRecord.incompleteReason }
                  : message
              )
            );
          }
        }
        if (messagesRef.current.length === 2) {
          void updateConversationTitle(conversationId, deriveConversationTitle(trimmedPrompt)).then((updated) => {
            if (updated) void refreshConversations();
          });
        }
      }

      let stopReason: GenerationStopReason | null = null;
      let runtimeErrorCode: RuntimeErrorCode | undefined;
      const generationStartedAt = Date.now();
      let firstTokenAt: number | null = null;
      const streamBuffer = createStreamingTextBuffer({
        onFlush: () => flushAccumulatorToMessages(generationId, conversationId, assistantId),
      });

      try {
        for await (const chunk of runtime.generate({
          conversationId,
          prompt: trimmedPrompt,
          responseLocale,
          maxOutputTokens,
        })) {
          if (!isGenerationCurrent(activeGenerationRef.current, generationId, conversationId)) break;

          if (chunk.type === "token") {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            const acc = generationAccumulatorRef.current;
            if (acc && acc.generationId === generationId) {
              acc.generatedDelta += chunk.text;
              acc.mergedContent = mergeContinuationOverlap(acc.priorContent, acc.generatedDelta);
            }
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

      const assistantText =
        generationAccumulatorRef.current?.generationId === generationId ? generationAccumulatorRef.current.mergedContent : "";

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

      const hasPartialOutput = assistantText.length > 0;
      const isIncompleteOutput = isIncompleteAssistantOutput(stopReason, runtimeErrorCode, hasPartialOutput);

      if (shouldDiscardPartialAssistantOutput(stopReason, runtimeErrorCode, hasPartialOutput)) {
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

      const incompleteReason = isIncompleteOutput ? incompleteReasonFor(stopReason, runtimeErrorCode) : undefined;
      if (isIncompleteOutput) {
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId ? { ...message, status: "incomplete", incompleteReason } : message
          )
        );
        const noticeKey = generationNoticeKey(stopReason, runtimeErrorCode, true);
        if (noticeKey) setStorageNoticeState({ key: noticeKey });
      }

      setActiveGeneration(null);
      if (stopReason === "completed" && assistantText.length === 0) {
        setMessages((previous) => removeAssistantMessage(previous, assistantId));
        return true;
      }

      if (shouldPersistAssistantOutput(stopReason, assistantText, runtimeErrorCode)) {
        const saved = await addMessage(conversationId, {
          id: assistantId,
          role: "assistant",
          content: assistantText,
          ...(isIncompleteOutput ? { status: "incomplete" as const, incompleteReason } : {}),
        });
        if (!saved) {
          setStorageNoticeState({ key: "storageNotice.couldNotSaveReply" });
        } else {
          if (saved.truncated) {
            setStorageNoticeState({ key: "storageNotice.generationTruncatedForStorage" });
            // Item 4: the store's own normalized message is authoritative
            // once it had to truncate -- adopt it into UI state exactly so
            // the transcript can never keep showing more than IndexedDB
            // actually holds.
            const savedMessage = saved.conversation.messages.find((message) => message.id === assistantId);
            if (savedMessage) {
              setMessages((previous) =>
                previous.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: savedMessage.content, status: savedMessage.status, incompleteReason: savedMessage.incompleteReason }
                    : message
                )
              );
            }
          }
          await refreshConversations();
        }
      }

      return true;
    },
    [
      flushAccumulatorToMessages,
      applyModelSwitchIfNeeded,
      evaluateRouting,
      recoverRuntime,
      refreshConversations,
      routerDecisionRef,
      setActiveConversationId,
      setActiveGeneration,
      setMessages,
    ]
  );

  // True only when the most recent message is an assistant reply left
  // "incomplete" (interrupted reasoning, a watchdog stall, or a WebLLM
  // finish_reason: "length"/"unsupported_tool_call"/"unknown_terminal" --
  // see generationPersistence.ts) and has not already been continued
  // MAX_CONTINUATIONS_PER_MESSAGE times. The count read here
  // (message.continuationCount) is durable, persisted through
  // @free-ai-open/conversation-store -- a page refresh does not reset it.
  // Recomputed from state (not refs) so it reliably re-renders the Continue
  // button.
  const canContinueGeneration = useMemo(() => {
    if (generation.generationId !== null) return false;
    const lastMessage = messages.at(-1);
    if (!lastMessage || !isMessageContinuable(lastMessage)) return false;
    const continuedSoFar = lastMessage.continuationCount ?? 0;
    return continuedSoFar < MAX_CONTINUATIONS_PER_MESSAGE;
  }, [generation, messages]);

  const continueGeneration = useCallback(async (): Promise<boolean> => {
    const runtime = lifecycleRef.current.getCurrentRuntime();
    if (!runtime || runtimeStateRef.current.status !== "ready") return false;

    const conversationId = activeConversationIdRef.current;
    const lastMessage = messagesRef.current.at(-1);
    if (!conversationId || !lastMessage || !isMessageContinuable(lastMessage)) {
      return false;
    }

    const assistantMessageId = lastMessage.id;
    const priorContent = lastMessage.content;
    const priorStatus = lastMessage.status;
    const priorIncompleteReason = lastMessage.incompleteReason;
    const priorContinuationCount = lastMessage.continuationCount ?? 0;
    if (priorContinuationCount >= MAX_CONTINUATIONS_PER_MESSAGE) return false;

    const precedingUserMessage = messagesRef.current
      .slice(0, -1)
      .reverse()
      .find((candidate) => candidate.role === "user");
    if (!precedingUserMessage) return false;

    const generationLocale = localeRef.current;
    const continuationPrompt = buildContinuationPrompt(precedingUserMessage.content, priorContent, generationLocale);

    const { maxOutputTokens, insufficientContext } = computeBudgetedOutputTokens(
      routerDecisionRef.current,
      generationLocale,
      continuationPrompt
    );
    if (insufficientContext) {
      // Item 5: never start a generation that cannot possibly produce a
      // useful amount of output -- the conversation has grown too long
      // relative to the loaded model's context window for a Continue to be
      // worthwhile. No attempt is consumed since nothing was ever started.
      setStorageNoticeState({ key: "storageNotice.generationContextTooLong" });
      return false;
    }

    setStorageNoticeState(null);

    // Durably persist that this attempt has been used BEFORE requesting any
    // token, so the count survives a crash mid-generation and a refresh can
    // never grant more than MAX_CONTINUATIONS_PER_MESSAGE real attempts.
    // status/incompleteReason are intentionally OMITTED (not re-passed) --
    // under updateMessageContent()'s explicit patch semantics, omitting a
    // field leaves it exactly as it already is, so only continuationCount
    // changes here.
    const nextContinuationCount = priorContinuationCount + 1;
    // content here is priorContent, re-persisted completely unchanged from
    // what is already durably stored -- this can never newly truncate, so
    // .truncated is always false and is intentionally not checked.
    const countPersisted = await updateMessageContent(conversationId, assistantMessageId, {
      content: priorContent,
      continuationCount: nextContinuationCount,
    });
    if (!countPersisted) {
      setStorageNoticeState({ key: "storageNotice.couldNotSaveReply" });
      return false;
    }
    setMessages((previous) =>
      previous.map((message) =>
        message.id === assistantMessageId ? { ...message, continuationCount: nextContinuationCount } : message
      )
    );

    const generationId = createClientId("generation");
    generationAccumulatorRef.current = {
      generationId,
      conversationId,
      assistantMessageId,
      priorContent,
      priorStatus,
      priorIncompleteReason,
      priorContinuationCount: nextContinuationCount,
      isContinuation: true,
      generatedDelta: "",
      mergedContent: priorContent,
    };
    // Reuses the SAME assistantMessageId with a NEW generationId, and does
    // not reset the message's content -- flushAccumulatorToMessages'
    // accumulator-driven setAssistantContent extends the same bubble
    // instead of duplicating it.
    setActiveGeneration({ generationId, conversationId, assistantMessageId });

    const generationStartedAt = Date.now();
    let firstTokenAt: number | null = null;
    const streamBuffer = createStreamingTextBuffer({
      onFlush: () => flushAccumulatorToMessages(generationId, conversationId, assistantMessageId),
    });

    // The actual streaming/persistence orchestration lives in
    // continuationExecution.ts's runContinuationAttempt(), extracted so it
    // can be exercised directly in a test without mounting React (see
    // continuationExecution.test.ts's dedicated regression test). Its
    // RETURN VALUE, not a mutable ref, is what this callback reads below --
    // that is the structural fix for the ordering bug where calling
    // setActiveGeneration(null) before reading the generation accumulator
    // made a successful continuation silently discard its own content.
    const outcome = await runContinuationAttempt({
      runtime,
      conversationId,
      assistantMessageId,
      priorContent,
      priorStatus,
      priorIncompleteReason,
      nextContinuationCount,
      continuationPrompt,
      responseLocale: generationLocale,
      maxOutputTokens,
      onProgress: (mergedContent) => {
        if (firstTokenAt === null) firstTokenAt = Date.now();
        // Still kept in sync for the watchdog-error effect above, which
        // reacts independently (via runtimeState.error, not this
        // function's return value) if generate()'s stream never delivers
        // its own terminal chunk at all. hasPartialOutput's fallback read of
        // acc.generatedDelta.length only matters for a fresh sendMessage()
        // (isContinuation short-circuits it to true for a continuation), so
        // only mergedContent needs updating here.
        const acc = generationAccumulatorRef.current;
        if (acc && acc.generationId === generationId) {
          acc.mergedContent = mergedContent;
        }
        streamBuffer.append(".");
      },
      isStillCurrent: () => isGenerationCurrent(activeGenerationRef.current, generationId, conversationId),
    });
    streamBuffer.flush();

    if (outcome.kind === "abandoned") {
      return false;
    }

    const currentRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
    if (currentRegistryId) {
      recordModelPerformanceObservation(
        buildGenerationObservation({
          modelId: currentRegistryId,
          firstTokenTimeMs: firstTokenAt !== null ? firstTokenAt - generationStartedAt : undefined,
          generationDurationMs: Date.now() - generationStartedAt,
          stopReason: outcome.stopReason,
          errorCode: outcome.kind === "persisted" ? outcome.errorCode : undefined,
        })
      );
      void evaluateRouting().then((decision) => applyModelSwitchIfNeeded(decision));
    }

    // Both outcomes already reflect the fully-resolved final state --
    // content, status, and incompleteReason were computed and persisted
    // inside runContinuationAttempt() before it returned, so applying them
    // to UI state here can never race with or be undone by clearing
    // activeGeneration/the accumulator below.
    setMessages((previous) =>
      previous.map((message) =>
        message.id === assistantMessageId
          ? { ...message, content: outcome.finalContent, status: outcome.status, incompleteReason: outcome.incompleteReason }
          : message
      )
    );
    if (outcome.noticeKey) setStorageNoticeState({ key: outcome.noticeKey });
    if (!outcome.persisted) setStorageNoticeState({ key: "storageNotice.couldNotSaveReply" });

    // Cleanup happens only now, after finalContent and every piece of
    // metadata have already been captured, applied to UI state, and
    // persisted -- never before.
    setActiveGeneration(null);

    if (outcome.kind === "reverted") {
      if (outcome.stopReason === "cancelled") {
        await recoverRuntime();
      }
      return true;
    }

    if (outcome.persisted) {
      if (outcome.truncated) setStorageNoticeState({ key: "storageNotice.generationTruncatedForStorage" });
      await refreshConversations();
    }

    return true;
  }, [
    flushAccumulatorToMessages,
    applyModelSwitchIfNeeded,
    evaluateRouting,
    recoverRuntime,
    refreshConversations,
    routerDecisionRef,
    setActiveGeneration,
    setMessages,
  ]);

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
      canContinueGeneration,
      continueGeneration,
    }),
    [
      activeConversationId,
      activeConversationTask,
      applyPerformanceMode,
      cancelModelSwitch,
      canContinueGeneration,
      clearObservations,
      configureChatRoute,
      confirmModelSwitch,
      continueGeneration,
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

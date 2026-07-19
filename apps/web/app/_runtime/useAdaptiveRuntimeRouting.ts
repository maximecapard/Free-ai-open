"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { DEFAULT_MODEL_ID, isModelCached } from "@free-ai-open/ai-runtime";
import type { InferenceRuntime, RuntimeLocale, RuntimeState } from "@free-ai-open/ai-runtime";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import { routeAdaptiveModel } from "@free-ai-open/model-router";
import type { RouterDecision } from "@free-ai-open/model-router";
import type { PerformanceMode, TaskCategory } from "@free-ai-open/types";
import type { TranslationKey } from "../_i18n/dictionary";
import { getStoredCapabilityProfile } from "../_lib/capabilityProfileStore";
import { setStoredPerformanceMode } from "../_lib/gettingStartedPreference";
import {
  getStoredManualModelPreference,
  setAutomaticModelSelection,
  setManualModelSelection,
} from "../_lib/manualModelPreference";
import type { ModelSelectionMode } from "../_lib/manualModelPreference";
import { isModelSwitchBlockedStatus, resolveModelSwitch } from "../_lib/modelSwitchPolicy";
import {
  clearStoredModelPerformanceObservations,
} from "../_lib/modelObservationStore";
import { isModelRepeatedlyFailing } from "../_lib/performanceObservationBuilder";
import { isPerformanceModeChangeBlockedStatus } from "../_lib/performanceModeRuntimePolicy";
import {
  buildObservationRevision,
  buildRoutingCacheKey,
  shouldRecomputeRouterDecision,
} from "../_lib/routingDecisionCache";
import { recordRuntimeRecoveryEvent } from "../_lib/runtimeRecovery";
import { isConversationSwitchBlockedStatus } from "../_lib/runtimeUiState";
import {
  attemptModelLoadWithFallback,
  buildLoadCandidatesFromDecision,
  buildRouterInputContext,
  filterDisclosedLoadCandidates,
  registryIdForWebllmModelId,
} from "./routingOrchestration";
import type { ModelLoadCandidate } from "./routingOrchestration";

const PRE_DISCLOSED_DEFAULT_MODEL_ID =
  modelRegistryV2.find((record) => record.webllmModelId === DEFAULT_MODEL_ID)?.id ?? DEFAULT_MODEL_ID;
const DEFAULT_LOAD_CANDIDATE: ModelLoadCandidate = {
  registryId: PRE_DISCLOSED_DEFAULT_MODEL_ID,
  webllmModelId: DEFAULT_MODEL_ID,
};
const PRE_DISCLOSED_MODEL_IDS = new Set([PRE_DISCLOSED_DEFAULT_MODEL_ID]);

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
  isMobileFormFactor: boolean;
}

interface RuntimeLifecycle {
  ensureRuntime(listener: (state: RuntimeState) => void): { runtime: InferenceRuntime };
  replaceRuntime(
    trigger: "explicit_reload" | "performance_replacement" | "recovery" | "model_replacement",
    listener: (state: RuntimeState) => void
  ): { runtime: InferenceRuntime };
  getCurrentRuntime(): InferenceRuntime | null;
  hasRuntime(): boolean;
}

export interface UseAdaptiveRuntimeRoutingOptions {
  lifecycleRef: MutableRefObject<RuntimeLifecycle>;
  runtimeStateRef: MutableRefObject<RuntimeState>;
  runtimeState: RuntimeState;
  setRuntimeStateSnapshot: (state: RuntimeState) => void;
  performanceMode: PerformanceMode | null;
  performanceModeRef: MutableRefObject<PerformanceMode | null>;
  setPerformanceMode: (mode: PerformanceMode | null) => void;
  activeConversationTask: TaskCategory;
  activeConversationTaskRef: MutableRefObject<TaskCategory>;
  locale: RuntimeLocale;
  localeRef: MutableRefObject<RuntimeLocale>;
}

function toPendingModelSwitch(record: ModelRegistryRecord): PendingModelSwitch {
  return {
    registryId: record.id,
    webllmModelId: record.webllmModelId,
    displayName: record.displayName,
    descriptionKey: record.descriptionKey as TranslationKey,
    downloadSizeBytes: record.downloadSize.value,
    isMobileFormFactor: getStoredCapabilityProfile()?.formFactor === "mobile",
  };
}

function contextWindowForCandidates(
  decision: RouterDecision | null,
  candidates: readonly ModelLoadCandidate[]
): number | undefined {
  if (!decision || decision.recommendedContextTokens <= 0) return undefined;
  const candidateMaximums = candidates.flatMap((candidate) => {
    const record = modelRegistryV2.find((model) => model.id === candidate.registryId);
    const maximum = record?.contextPresets.at(-1)?.contextTokens;
    return maximum === undefined ? [] : [maximum];
  });
  if (candidateMaximums.length === 0) return undefined;
  return Math.min(decision.recommendedContextTokens, ...candidateMaximums);
}

export function useAdaptiveRuntimeRouting(options: UseAdaptiveRuntimeRoutingOptions) {
  const {
    activeConversationTask,
    activeConversationTaskRef,
    lifecycleRef,
    locale,
    localeRef,
    performanceMode,
    performanceModeRef,
    runtimeStateRef,
    runtimeState,
    setPerformanceMode,
    setRuntimeStateSnapshot,
  } = options;
  const [routerDecision, setRouterDecisionState] = useState<RouterDecision | null>(null);
  const [pendingModelSwitch, setPendingModelSwitch] = useState<PendingModelSwitch | null>(null);
  const [modelSelectionMode, setModelSelectionMode] = useState<ModelSelectionMode>("automatic");
  const [manualModelId, setManualModelIdState] = useState<string | null>(null);
  const [isRoutingInProgress, setIsRoutingInProgress] = useState(false);
  const [isFallbackRetry, setIsFallbackRetry] = useState(false);

  const routerDecisionRef = useRef<RouterDecision | null>(null);
  const routingCacheKeyRef = useRef<string | null>(null);
  const manualModelIdRef = useRef<string | null>(null);
  const routingEpochRef = useRef(0);
  const modelSwitchEpochRef = useRef(0);
  const runtimeLoadEpochRef = useRef(0);
  const recoveryInProgressRef = useRef(false);
  const loadedManualPreferenceRef = useRef(false);
  const declinedModelIdsRef = useRef(new Set<string>());
  const failedModelIdsRef = useRef(new Set<string>());

  const setRouterDecision = useCallback((decision: RouterDecision | null) => {
    routerDecisionRef.current = decision;
    setRouterDecisionState(decision);
  }, []);

  const setManualModelId = useCallback((modelId: string | null) => {
    manualModelIdRef.current = modelId;
    setManualModelIdState(modelId);
  }, []);

  useEffect(() => {
    if (loadedManualPreferenceRef.current) return;
    loadedManualPreferenceRef.current = true;
    const stored = getStoredManualModelPreference();
    setModelSelectionMode(stored.mode);
    setManualModelId(stored.manualModelId);
  }, [setManualModelId]);

  const evaluateRouting = useCallback(async (): Promise<RouterDecision | null> => {
    const mode = performanceModeRef.current;
    if (!mode) return routerDecisionRef.current;

    const routingEpoch = ++routingEpochRef.current;
    setIsRoutingInProgress(true);
    try {
      const routerInput = await buildRouterInputContext({
        task: activeConversationTaskRef.current,
        locale: localeRef.current,
        performanceMode: mode,
        manualModelId: manualModelIdRef.current ?? undefined,
      });

      if (routingEpoch !== routingEpochRef.current) return routerDecisionRef.current;
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
        observationsRevision: buildObservationRevision(routerInput.observations),
      });
      if (!shouldRecomputeRouterDecision(routingCacheKeyRef.current, cacheKey)) {
        return routerDecisionRef.current;
      }

      const decision = routeAdaptiveModel(routerInput);
      if (routingEpoch !== routingEpochRef.current) return routerDecisionRef.current;
      routingCacheKeyRef.current = cacheKey;
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
    } finally {
      if (routingEpoch === routingEpochRef.current) setIsRoutingInProgress(false);
    }
  }, [activeConversationTaskRef, localeRef, performanceModeRef, runtimeStateRef, setRouterDecision]);

  const resolveInitialLoadCandidates = useCallback(async (decision: RouterDecision | null): Promise<ModelLoadCandidate[]> => {
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
      isDownloadDeclined: declinedModelIdsRef.current.has(selectedRecord.id),
      isPreDisclosedDefault: selectedRecord.id === PRE_DISCLOSED_DEFAULT_MODEL_ID,
    });
    if (switchDecision.type === "needs_consent") {
      setPendingModelSwitch(toPendingModelSwitch(selectedRecord));
      return [DEFAULT_LOAD_CANDIDATE];
    }
    if (switchDecision.type === "declined" || failedModelIdsRef.current.has(selectedRecord.id)) {
      return [DEFAULT_LOAD_CANDIDATE];
    }

    const candidates = buildLoadCandidatesFromDecision(modelRegistryV2, [
      decision.selectedModelId,
      ...decision.fallbackModelIds,
    ]);
    return filterDisclosedLoadCandidates(candidates, { preDisclosedRegistryIds: PRE_DISCLOSED_MODEL_IDS });
  }, []);

  const initializeRuntime = useCallback(async (
    reason: "initial" | "explicit_reload" | "performance_replacement" | "recovery" | "model_replacement" = "initial",
    explicitCandidates?: ModelLoadCandidate[],
    approvedRegistryId?: string
  ): Promise<boolean> => {
    const busyBlocked = reason === "model_replacement"
      ? isModelSwitchBlockedStatus(runtimeStateRef.current.status)
      : reason !== "recovery" && isConversationSwitchBlockedStatus(runtimeStateRef.current.status);
    if (busyBlocked) return false;

    const lifecycle = lifecycleRef.current;
    if (reason === "initial" && lifecycle.hasRuntime()) return true;
    const priorRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
    const runtimeLoadEpoch = ++runtimeLoadEpochRef.current;
    const isRecovery = reason === "recovery";
    if (isRecovery) recordRuntimeRecoveryEvent("runtime.recovery.started", "info", "recovering");

    const instance = reason === "initial"
      ? lifecycle.ensureRuntime(setRuntimeStateSnapshot)
      : lifecycle.replaceRuntime(reason, setRuntimeStateSnapshot);
    setRuntimeStateSnapshot(
      isRecovery ? { status: "recovering", modelId: null, loadProgress: 0, error: null } : instance.runtime.getState()
    );

    let decision = routerDecisionRef.current;
    if (reason === "initial" || !decision) decision = await evaluateRouting();
    if (runtimeLoadEpoch !== runtimeLoadEpochRef.current || lifecycle.getCurrentRuntime() !== instance.runtime) return true;

    let candidates = explicitCandidates;
    if (!candidates) {
      if (reason === "initial") {
        candidates = await resolveInitialLoadCandidates(decision);
      } else {
        const decisionIds = decision?.selectedModelId
          ? [decision.selectedModelId, ...decision.fallbackModelIds]
          : [];
        const candidateIds = isRecovery && priorRegistryId
          ? [priorRegistryId, ...decisionIds.filter((id) => id !== priorRegistryId)]
          : decisionIds;
        candidates = await filterDisclosedLoadCandidates(
          buildLoadCandidatesFromDecision(modelRegistryV2, candidateIds),
          { preDisclosedRegistryIds: PRE_DISCLOSED_MODEL_IDS }
        );
      }
    } else {
      candidates = await filterDisclosedLoadCandidates(candidates, {
        approvedRegistryIds: approvedRegistryId ? new Set([approvedRegistryId]) : undefined,
        preDisclosedRegistryIds: PRE_DISCLOSED_MODEL_IDS,
      });
    }
    if (candidates.length === 0) candidates = [DEFAULT_LOAD_CANDIDATE];
    if (runtimeLoadEpoch !== runtimeLoadEpochRef.current || lifecycle.getCurrentRuntime() !== instance.runtime) return true;

    setIsFallbackRetry(false);
    try {
      const result = await attemptModelLoadWithFallback(instance.runtime, candidates, {
        initialStatus: isRecovery ? "recovering" : "loading_model",
        contextWindowTokens: contextWindowForCandidates(decision, candidates),
        onAttempt: (_candidate, attemptIndex) => {
          if (attemptIndex > 0) setIsFallbackRetry(true);
        },
      });
      for (const modelId of result.failedRegistryIds) failedModelIdsRef.current.add(modelId);
      if (result.registryId) failedModelIdsRef.current.delete(result.registryId);
      if (result.failedRegistryIds.length > 0) routingCacheKeyRef.current = null;
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

    if (runtimeLoadEpoch !== runtimeLoadEpochRef.current || lifecycle.getCurrentRuntime() !== instance.runtime) return true;
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
  }, [evaluateRouting, lifecycleRef, resolveInitialLoadCandidates, runtimeStateRef, setRuntimeStateSnapshot]);

  const performModelSwitch = useCallback(async (
    decision: RouterDecision,
    approvedRegistryId?: string
  ): Promise<void> => {
    if (!decision.selectedModelId) return;
    if (!approvedRegistryId && failedModelIdsRef.current.has(decision.selectedModelId)) return;
    const candidates = buildLoadCandidatesFromDecision(modelRegistryV2, [
      decision.selectedModelId,
      ...decision.fallbackModelIds,
    ]);
    if (candidates.length === 0) return;
    await initializeRuntime("model_replacement", candidates, approvedRegistryId);
  }, [initializeRuntime]);

  const applyModelSwitchIfNeeded = useCallback(async (decision: RouterDecision | null): Promise<void> => {
    if (!decision?.selectedModelId || !lifecycleRef.current.hasRuntime()) return;
    const selectedRecord = modelRegistryV2.find((record) => record.id === decision.selectedModelId);
    if (!selectedRecord) return;

    const switchEpoch = ++modelSwitchEpochRef.current;
    const currentRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
    if (currentRegistryId === selectedRecord.id) {
      setPendingModelSwitch(null);
      return;
    }
    if (failedModelIdsRef.current.has(selectedRecord.id)) {
      setPendingModelSwitch(null);
      return;
    }

    const cached = await isModelCached(selectedRecord.webllmModelId);
    if (switchEpoch !== modelSwitchEpochRef.current) return;
    const switchDecision = resolveModelSwitch({
      currentModelId: currentRegistryId,
      selectedModelId: selectedRecord.id,
      runtimeStatus: runtimeStateRef.current.status,
      isCached: cached,
      isDownloadDeclined: declinedModelIdsRef.current.has(selectedRecord.id),
      isPreDisclosedDefault: selectedRecord.id === PRE_DISCLOSED_DEFAULT_MODEL_ID,
    });
    if (switchDecision.type === "switch_now") {
      setPendingModelSwitch(null);
      await performModelSwitch(decision);
    } else if (switchDecision.type === "needs_consent") {
      setPendingModelSwitch(toPendingModelSwitch(selectedRecord));
    } else if (switchDecision.type === "declined") {
      setPendingModelSwitch(null);
    }
  }, [lifecycleRef, performModelSwitch, runtimeStateRef]);

  const refreshRoutingDecision = useCallback(async (): Promise<void> => {
    routingCacheKeyRef.current = null;
    const decision = await evaluateRouting();
    await applyModelSwitchIfNeeded(decision);
  }, [applyModelSwitchIfNeeded, evaluateRouting]);

  const confirmModelSwitch = useCallback(async (): Promise<void> => {
    if (!pendingModelSwitch) return;
    setPendingModelSwitch(null);
    declinedModelIdsRef.current.delete(pendingModelSwitch.registryId);
    failedModelIdsRef.current.delete(pendingModelSwitch.registryId);
    const decision = routerDecisionRef.current;
    if (decision?.selectedModelId === pendingModelSwitch.registryId) {
      await performModelSwitch(decision, pendingModelSwitch.registryId);
    }
  }, [pendingModelSwitch, performModelSwitch]);

  const cancelModelSwitch = useCallback(() => {
    if (pendingModelSwitch) declinedModelIdsRef.current.add(pendingModelSwitch.registryId);
    setPendingModelSwitch(null);
  }, [pendingModelSwitch]);

  const recoverRuntime = useCallback(async (): Promise<boolean> => {
    if (recoveryInProgressRef.current) return false;
    recoveryInProgressRef.current = true;
    try {
      return await initializeRuntime("recovery");
    } finally {
      recoveryInProgressRef.current = false;
    }
  }, [initializeRuntime]);

  const reloadRuntime = useCallback(async (): Promise<boolean> => {
    const currentRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
    if (currentRegistryId) failedModelIdsRef.current.delete(currentRegistryId);
    return initializeRuntime("explicit_reload");
  }, [initializeRuntime, runtimeStateRef]);

  const applyPerformanceMode = useCallback(async (nextMode: PerformanceMode): Promise<PerformanceModeApplyResult> => {
    if (performanceModeRef.current === nextMode) return { ok: true, replacedRuntime: false };
    if (isPerformanceModeChangeBlockedStatus(runtimeStateRef.current.status)) {
      return { ok: false, replacedRuntime: false, blockedReason: "active_generation" };
    }

    const previousRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
    setStoredPerformanceMode(nextMode);
    setPerformanceMode(nextMode);
    routingCacheKeyRef.current = null;
    const decision = await evaluateRouting();
    if (decision) await applyModelSwitchIfNeeded(decision);
    const nextRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
    return { ok: true, replacedRuntime: lifecycleRef.current.hasRuntime() && nextRegistryId !== previousRegistryId };
  }, [applyModelSwitchIfNeeded, evaluateRouting, lifecycleRef, performanceModeRef, runtimeStateRef, setPerformanceMode]);

  const setManualModel = useCallback(async (modelId: string): Promise<void> => {
    declinedModelIdsRef.current.delete(modelId);
    failedModelIdsRef.current.delete(modelId);
    setManualModelSelection(modelId);
    setModelSelectionMode("manual");
    setManualModelId(modelId);
    routingCacheKeyRef.current = null;
    const decision = await evaluateRouting();
    if (decision) await applyModelSwitchIfNeeded(decision);
  }, [applyModelSwitchIfNeeded, evaluateRouting, setManualModelId]);

  const setAutomaticModel = useCallback(async (): Promise<void> => {
    setAutomaticModelSelection();
    setModelSelectionMode("automatic");
    setManualModelId(null);
    routingCacheKeyRef.current = null;
    const decision = await evaluateRouting();
    if (decision) await applyModelSwitchIfNeeded(decision);
  }, [applyModelSwitchIfNeeded, evaluateRouting, setManualModelId]);

  const clearObservations = useCallback(async (): Promise<void> => {
    clearStoredModelPerformanceObservations();
    await refreshRoutingDecision();
  }, [refreshRoutingDecision]);

  useEffect(() => {
    if (!performanceMode) return;
    void refreshRoutingDecision();
  }, [activeConversationTask, locale, manualModelId, performanceMode, refreshRoutingDecision]);

  const selectedModel = useMemo<ModelRegistryRecord | null>(
    () => routerDecision?.selectedModelId
      ? modelRegistryV2.find((record) => record.id === routerDecision.selectedModelId) ?? null
      : null,
    [routerDecision]
  );
  const loadedModel = useMemo<ModelRegistryRecord | null>(
    () => {
      const registryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
      return registryId ? modelRegistryV2.find((record) => record.id === registryId) ?? null : null;
    }, [runtimeState.modelId]
  );

  return {
    routerDecision,
    routerDecisionRef,
    selectedModel,
    loadedModel,
    pendingModelSwitch,
    modelSelectionMode,
    manualModelId,
    isRoutingInProgress,
    isFallbackRetry,
    evaluateRouting,
    applyModelSwitchIfNeeded,
    initializeRuntime,
    recoverRuntime,
    reloadRuntime,
    applyPerformanceMode,
    confirmModelSwitch,
    cancelModelSwitch,
    setManualModel,
    setAutomaticModel,
    clearObservations,
    refreshRoutingDecision,
  };
}

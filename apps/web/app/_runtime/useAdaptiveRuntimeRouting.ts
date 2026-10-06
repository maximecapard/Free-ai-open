"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { DEFAULT_MODEL_ID, isModelCached } from "@free-ai-open/ai-runtime";
import type {
  InferenceRuntime,
  RuntimeLocale,
  RuntimeOperationCoordinator,
  RuntimeOperationLease,
  RuntimeRecoveryResult,
  RuntimeState,
} from "@free-ai-open/ai-runtime";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import { routeAdaptiveModel } from "@free-ai-open/model-router";
import type { RouterDecision } from "@free-ai-open/model-router";
import type { PerformanceMode, TaskCategory } from "@free-ai-open/types";
import type { TranslationKey } from "../_i18n/dictionary";
import { getStoredCapabilityProfile } from "../_lib/capabilityProfileStore";
import { setStoredPerformanceMode } from "../_lib/gettingStartedPreference";
import { RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS, awaitWithDeadline } from "../_lib/replacementLoadBound";
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

// The slice of the persistent runtime lifecycle this hook needs. Creation and
// replacement are asynchronous and SEQUENTIAL: a replacement is only created
// after the previous worker is confirmed terminated, and `ok: false` means no
// replacement exists because isolation could not be confirmed.
interface RuntimeLifecycle {
  ensureRuntimeSequenced(listener: (state: RuntimeState) => void): Promise<RuntimeLifecycleResult>;
  replaceRuntime(
    trigger: "explicit_reload" | "performance_replacement" | "recovery" | "model_replacement",
    listener: (state: RuntimeState) => void
  ): Promise<RuntimeLifecycleResult>;
  isolateCurrent(): Promise<{ isolated: boolean }>;
  confirmIsolation(): Promise<{ isolated: boolean }>;
  getCurrentRuntime(): InferenceRuntime | null;
  hasRuntime(): boolean;
}

// Optional caps on how long an initialization may wait for its replacement
// model to load. Recovery always has one (see replacementLoadBound.ts); a
// reroute the watchdog triggers passes one explicitly so it cannot hold
// runtime ownership for ever either.
export interface InitializationBounds {
  replacementLoadTimeoutMs?: number;
}

type RuntimeLifecycleResult = { ok: true; instance: { runtime: InferenceRuntime } } | { ok: false; isolated: false };

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
  runtimeOperations: RuntimeOperationCoordinator;
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
    runtimeOperations,
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
  const initializationsInFlightRef = useRef(0);
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

  // Replaces/creates the runtime and reports the outcome as TWO independent
  // facts (see RuntimeRecoveryResult in @free-ai-open/ai-runtime):
  //
  // - isolated: the previous runtime/worker domain is confirmed terminated.
  //   Replacement is physically sequential -- the lifecycle only creates the
  //   new worker after the old one is confirmed gone -- so isolated=false
  //   means NO replacement was created. The lease (borrowed or acquired) is
  //   then QUARANTINED rather than released: the coordinator stays
  //   unavailable to ordinary operations until a later isolation retry
  //   (see the quarantine-lift step below) proves the old worker is gone.
  // - ready: the replacement loaded a model and is usable.
  //
  // `existingLease` lets recovery triggered BY the current owner run under
  // that same lease instead of acquiring a second one (which would be
  // refused as busy and could fail forever).
  //
  // Safety and readiness are separate phases. Phase A (isolating the old
  // domain) is what a lease's release depends on and is bounded by the worker
  // teardown. Phase B (loading the replacement model) is optional for the
  // lease: during recovery, or whenever `bounds` asks for it, the replacement
  // load itself is capped. If the cap is hit the replacement worker is torn
  // down and isolated too and the result is {isolated: true, ready: false} --
  // an uncooperative loadModel() can therefore never keep ownership.
  const runRuntimeInitialization = useCallback(async (
    reason: "initial" | "explicit_reload" | "performance_replacement" | "recovery" | "model_replacement" = "initial",
    explicitCandidates?: ModelLoadCandidate[],
    approvedRegistryId?: string,
    existingLease?: RuntimeOperationLease,
    bounds?: InitializationBounds
  ): Promise<RuntimeRecoveryResult> => {
    const notIsolated: RuntimeRecoveryResult = { isolated: false, ready: false };
    const busyBlocked = reason === "model_replacement"
      ? isModelSwitchBlockedStatus(runtimeStateRef.current.status)
      : reason !== "recovery" && isConversationSwitchBlockedStatus(runtimeStateRef.current.status);
    if (busyBlocked) return notIsolated;

    // A previous recovery that could not prove isolation left the shared
    // coordinator quarantined. Only an explicit retry that CONFIRMS the old
    // worker is gone (and no initialization is mid-flight) may lift it.
    if (runtimeOperations.isQuarantined()) {
      if (initializationsInFlightRef.current > 0) return notIsolated;
      const isolation = await lifecycleRef.current.confirmIsolation();
      if (!isolation.isolated || !runtimeOperations.clearQuarantine({ isolated: true, ready: false })) return notIsolated;
    }

    const borrowedLease = existingLease && runtimeOperations.isLeaseCurrent(existingLease) ? existingLease : null;
    const acquiredLease = borrowedLease ? null : runtimeOperations.tryAcquire(`app-runtime:${reason}`);
    const lease = borrowedLease ?? acquiredLease;
    if (!lease) return notIsolated;

    initializationsInFlightRef.current += 1;
    try {
      const lifecycle = lifecycleRef.current;
      if (reason === "initial" && lifecycle.hasRuntime()) {
        return { isolated: true, ready: lifecycle.getCurrentRuntime()?.getState().status === "ready" };
      }
      const priorRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
      const runtimeLoadEpoch = ++runtimeLoadEpochRef.current;
      const isRecovery = reason === "recovery";
      if (isRecovery) recordRuntimeRecoveryEvent("runtime.recovery.started", "info", "recovering");

      // Mark the old runtime unusable and block new work BEFORE teardown.
      if (isRecovery) {
        setRuntimeStateSnapshot({ status: "recovering", modelId: null, loadProgress: 0, error: null });
      }

      let instance: { runtime: InferenceRuntime };
      try {
        const replacement = reason === "initial"
          ? await lifecycle.ensureRuntimeSequenced(setRuntimeStateSnapshot)
          : await lifecycle.replaceRuntime(reason, setRuntimeStateSnapshot);
        if (!replacement.ok) {
          lease.quarantine();
          setRuntimeStateSnapshot({
            status: "error",
            modelId: null,
            loadProgress: 0,
            error: { code: "unknown", message: "Runtime isolation could not be confirmed." },
          });
          if (isRecovery) recordRuntimeRecoveryEvent("runtime.recovery.failed", "error", "error", "RUNTIME_ISOLATION_UNCONFIRMED");
          return notIsolated;
        }
        instance = replacement.instance;
      } catch {
        // Unexpected failure while tearing down: nothing proves the old
        // domain is gone, so fail closed.
        lease.quarantine();
        return notIsolated;
      }
      setRuntimeStateSnapshot(
        isRecovery ? { status: "recovering", modelId: null, loadProgress: 0, error: null } : instance.runtime.getState()
      );

      // From here on the previous domain IS isolated (its worker was
      // confirmed terminated); only readiness remains in question.
      const superseded = (): boolean =>
        runtimeLoadEpoch !== runtimeLoadEpochRef.current || lifecycle.getCurrentRuntime() !== instance.runtime;
      const currentReadiness = (): RuntimeRecoveryResult => ({
        isolated: true,
        ready: lifecycle.getCurrentRuntime()?.getState().status === "ready",
      });

      let decision = routerDecisionRef.current;
      if (reason === "initial" || !decision) decision = await evaluateRouting();
      if (superseded()) return currentReadiness();

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
      if (superseded()) return currentReadiness();

      setIsFallbackRetry(false);
      const loadTimeoutMs = bounds?.replacementLoadTimeoutMs ?? (isRecovery ? RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS : null);
      let loadAbandoned = false;
      const loadOutcome = await awaitWithDeadline(
        attemptModelLoadWithFallback(instance.runtime, candidates, {
          initialStatus: isRecovery ? "recovering" : "loading_model",
          contextWindowTokens: contextWindowForCandidates(decision, candidates),
          onAttempt: (_candidate, attemptIndex) => {
            if (attemptIndex > 0) setIsFallbackRetry(true);
          },
          isCancelled: () => loadAbandoned,
        }),
        loadTimeoutMs
      );

      if (loadOutcome.kind === "timeout") {
        // The replacement load did not finish in time and cannot be
        // interrupted: abandon it and isolate ITS worker as well, so no
        // uncooperative load outlives this ownership scope.
        loadAbandoned = true;
        if (superseded()) return currentReadiness();
        let replacementIsolation: { isolated: boolean };
        try {
          replacementIsolation = await lifecycle.isolateCurrent();
        } catch {
          replacementIsolation = { isolated: false };
        }
        if (!replacementIsolation.isolated) {
          lease.quarantine();
          setRuntimeStateSnapshot({
            status: "error",
            modelId: null,
            loadProgress: 0,
            error: { code: "unknown", message: "Runtime isolation could not be confirmed." },
          });
          if (isRecovery) recordRuntimeRecoveryEvent("runtime.recovery.failed", "error", "error", "RUNTIME_ISOLATION_UNCONFIRMED");
          return notIsolated;
        }
        setRuntimeStateSnapshot({
          status: "error",
          modelId: null,
          loadProgress: 0,
          error: { code: "model_load_failed", message: "The replacement model did not finish loading in time." },
        });
        if (isRecovery) recordRuntimeRecoveryEvent("runtime.recovery.failed", "error", "error", "RUNTIME_RECOVERY_LOAD_TIMEOUT");
        return { isolated: true, ready: false };
      }

      if (loadOutcome.kind === "rejected") {
        if (!superseded()) {
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
        return { isolated: true, ready: false };
      }

      const loadResult = loadOutcome.value;
      for (const modelId of loadResult.failedRegistryIds) failedModelIdsRef.current.add(modelId);
      if (loadResult.registryId) failedModelIdsRef.current.delete(loadResult.registryId);
      if (loadResult.failedRegistryIds.length > 0) routingCacheKeyRef.current = null;

      if (superseded()) return currentReadiness();
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
      return { isolated: true, ready: nextState.status === "ready" };
    } finally {
      initializationsInFlightRef.current -= 1;
      // A no-op when the lease was quarantined above.
      acquiredLease?.release();
    }
  }, [evaluateRouting, lifecycleRef, resolveInitialLoadCandidates, runtimeOperations, runtimeStateRef, setRuntimeStateSnapshot]);

  // Boolean convenience for callers that only care whether a usable runtime
  // exists afterwards (initial load, explicit reload, model switches).
  const initializeRuntime = useCallback(async (
    reason: "initial" | "explicit_reload" | "performance_replacement" | "recovery" | "model_replacement" = "initial",
    explicitCandidates?: ModelLoadCandidate[],
    approvedRegistryId?: string,
    existingLease?: RuntimeOperationLease
  ): Promise<boolean> => (await runRuntimeInitialization(reason, explicitCandidates, approvedRegistryId, existingLease)).ready,
  [runRuntimeInitialization]);

  // Resolves with the outcome of the runtime REPLACEMENT it performed -- two
  // independent facts, never inferred from side effects -- or null when no
  // replacement was attempted (nothing to switch to, or a precondition kept it
  // from starting).
  const performModelSwitch = useCallback(async (
    decision: RouterDecision,
    approvedRegistryId?: string,
    bounds?: InitializationBounds
  ): Promise<RuntimeRecoveryResult | null> => {
    if (!decision.selectedModelId) return null;
    if (!approvedRegistryId && failedModelIdsRef.current.has(decision.selectedModelId)) return null;
    const candidates = buildLoadCandidatesFromDecision(modelRegistryV2, [
      decision.selectedModelId,
      ...decision.fallbackModelIds,
    ]);
    if (candidates.length === 0) return null;
    return runRuntimeInitialization("model_replacement", candidates, approvedRegistryId, undefined, bounds);
  }, [runRuntimeInitialization]);

  const applyModelSwitchIfNeeded = useCallback(async (
    decision: RouterDecision | null,
    bounds?: InitializationBounds
  ): Promise<RuntimeRecoveryResult | null> => {
    if (!decision?.selectedModelId || !lifecycleRef.current.hasRuntime()) return null;
    const selectedRecord = modelRegistryV2.find((record) => record.id === decision.selectedModelId);
    if (!selectedRecord) return null;

    const switchEpoch = ++modelSwitchEpochRef.current;
    const currentRegistryId = registryIdForWebllmModelId(modelRegistryV2, runtimeStateRef.current.modelId);
    if (currentRegistryId === selectedRecord.id) {
      setPendingModelSwitch(null);
      return null;
    }
    if (failedModelIdsRef.current.has(selectedRecord.id)) {
      setPendingModelSwitch(null);
      return null;
    }

    const cached = await isModelCached(selectedRecord.webllmModelId);
    if (switchEpoch !== modelSwitchEpochRef.current) return null;
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
      return performModelSwitch(decision, undefined, bounds);
    } else if (switchDecision.type === "needs_consent") {
      setPendingModelSwitch(toPendingModelSwitch(selectedRecord));
    } else if (switchDecision.type === "declined") {
      setPendingModelSwitch(null);
    }
    return null;
  }, [lifecycleRef, performModelSwitch, runtimeStateRef]);

  const refreshRoutingDecision = useCallback(async (): Promise<void> => {
    routingCacheKeyRef.current = null;
    const decision = await evaluateRouting();
    await applyModelSwitchIfNeeded(decision);
  }, [applyModelSwitchIfNeeded, evaluateRouting]);

  // The reroute the WATCHDOG performs after a stall/safety-limit recovery.
  // Unlike refreshRoutingDecision() it reports what any model replacement it
  // performed actually achieved (so recovery can never claim readiness the
  // replacement did not deliver), and the replacement is bounded like
  // recovery's own -- it must not hold runtime ownership for ever.
  const refreshRoutingAfterRecovery = useCallback(async (): Promise<RuntimeRecoveryResult | null> => {
    routingCacheKeyRef.current = null;
    const decision = await evaluateRouting();
    return applyModelSwitchIfNeeded(decision, { replacementLoadTimeoutMs: RECOVERY_REPLACEMENT_LOAD_TIMEOUT_MS });
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

  // Recovery reports isolation and readiness separately -- never a single
  // "success" boolean. Pass the CURRENT OWNER's lease when recovery is
  // triggered by that owner (watchdog/cancel handling), so it runs inside
  // the same ownership scope instead of competing for a second lease.
  const recoverRuntime = useCallback(async (existingLease?: RuntimeOperationLease): Promise<RuntimeRecoveryResult> => {
    if (recoveryInProgressRef.current) return { isolated: false, ready: false };
    recoveryInProgressRef.current = true;
    try {
      return await runRuntimeInitialization("recovery", undefined, undefined, existingLease);
    } finally {
      recoveryInProgressRef.current = false;
    }
  }, [runRuntimeInitialization]);

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
    refreshRoutingAfterRecovery,
  };
}

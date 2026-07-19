import { isModelCached } from "@free-ai-open/ai-runtime";
import type { InferenceRuntime, RuntimeErrorCode } from "@free-ai-open/ai-runtime";
import { MODEL_REGISTRY_VERSION, modelRegistryV2 } from "@free-ai-open/model-registry";
import type { ModelRegistryRecord } from "@free-ai-open/model-registry";
import type { RouterInput } from "@free-ai-open/model-router";
import type { PerformanceMode, StaticCapabilityProfile, TaskCategory } from "@free-ai-open/types";
import { getStoredLocalBenchmarkForProfile } from "../_lib/benchmarkResultStore";
import { getStoredCapabilityProfile } from "../_lib/capabilityProfileStore";
import { detectAndStoreDeviceProfile } from "../_lib/deviceProfileDetection";
import { getStoredModelPerformanceObservations, recordModelPerformanceObservation } from "../_lib/modelObservationStore";
import { buildLoadObservation } from "../_lib/performanceObservationBuilder";

export interface BuildRouterInputContext {
  task: TaskCategory;
  locale: "en" | "fr";
  performanceMode: PerformanceMode;
  manualModelId?: string;
}

// Gathers everything routeAdaptiveModel() needs. Returns null only when no
// capability profile could be produced at all (e.g. detection genuinely
// failed) — the caller falls back to v0.6.6 behavior in that case. Never
// guesses cache status from registry metadata alone (see cache.ts) and never
// re-detects capability when a valid, unexpired profile is already stored.
export async function buildRouterInputContext(context: BuildRouterInputContext): Promise<RouterInput | null> {
  const capability = await resolveCapabilityProfile();
  if (!capability) return null;

  const benchmark = getStoredLocalBenchmarkForProfile(capability) ?? undefined;
  const observations = getStoredModelPerformanceObservations();
  const cachedModelIds = await resolveCachedModelIds();

  return {
    task: context.task,
    locale: context.locale,
    performanceMode: context.performanceMode,
    capability,
    benchmark,
    observations,
    cachedModelIds,
    registryVersion: MODEL_REGISTRY_VERSION,
    manualModelId: context.manualModelId,
  };
}

async function resolveCapabilityProfile(): Promise<StaticCapabilityProfile | null> {
  const stored = getStoredCapabilityProfile();
  if (stored) return stored;
  const deviceProfile = await detectAndStoreDeviceProfile();
  return deviceProfile.staticCapabilityProfile ?? null;
}

async function resolveCachedModelIds(): Promise<string[]> {
  const checks = await Promise.all(
    modelRegistryV2.map(async (record) => ((await isModelCached(record.webllmModelId)) ? record.id : null))
  );
  return checks.filter((id): id is string => id !== null);
}

// A router decision and the runtime's loadModel() speak different ID spaces:
// RouterDecision.selectedModelId/fallbackModelIds and every stored
// ModelPerformanceObservation.modelId are registry IDs (adaptiveRouter.ts
// matches observations via `item.modelId === model.id`), but
// InferenceRuntime.loadModel() and RuntimeState.modelId are WebLLM model IDs.
// Candidates carry both so each attempt loads the right WebLLM model while
// recording the observation under the registry ID the router expects.
export interface ModelLoadCandidate {
  registryId: string;
  webllmModelId: string;
}

export interface AttemptModelLoadResult {
  registryId: string | null;
  webllmModelId: string | null;
  succeeded: boolean;
  attemptedRegistryIds: string[];
  failedRegistryIds: string[];
}

// Turns a RouterDecision's [selectedModelId, ...fallbackModelIds] (registry
// IDs, possibly containing nulls/unknown IDs from a stale decision) into an
// ordered list of load candidates. Unknown IDs are dropped rather than
// throwing — a decision computed against a slightly older registry snapshot
// should still degrade gracefully to whichever candidates are still valid.
export function buildLoadCandidatesFromDecision(
  registry: readonly ModelRegistryRecord[],
  modelIds: readonly (string | null)[]
): ModelLoadCandidate[] {
  const candidates: ModelLoadCandidate[] = [];
  for (const modelId of modelIds) {
    if (!modelId) continue;
    const record = registry.find((candidate) => candidate.id === modelId);
    if (record) candidates.push({ registryId: record.id, webllmModelId: record.webllmModelId });
  }
  return candidates;
}

export interface DisclosedLoadCandidateOptions {
  approvedRegistryIds?: ReadonlySet<string>;
  preDisclosedRegistryIds?: ReadonlySet<string>;
}

export async function filterDisclosedLoadCandidates(
  candidates: readonly ModelLoadCandidate[],
  options: DisclosedLoadCandidateOptions = {}
): Promise<ModelLoadCandidate[]> {
  const approved = options.approvedRegistryIds ?? new Set<string>();
  const preDisclosed = options.preDisclosedRegistryIds ?? new Set<string>();
  const result: ModelLoadCandidate[] = [];

  for (const candidate of candidates) {
    if (approved.has(candidate.registryId) || preDisclosed.has(candidate.registryId) || await isModelCached(candidate.webllmModelId)) {
      result.push(candidate);
    }
  }
  return result;
}

// The inverse lookup: RuntimeState.modelId is a WebLLM ID, but model-switch
// policy (modelSwitchPolicy.ts) compares registry IDs. Returns null for an
// unloaded runtime or a WebLLM ID no longer present in the registry.
export function registryIdForWebllmModelId(
  registry: readonly ModelRegistryRecord[],
  webllmModelId: string | null
): string | null {
  if (!webllmModelId) return null;
  return registry.find((record) => record.webllmModelId === webllmModelId)?.id ?? null;
}

export interface AttemptModelLoadOptions {
  initialStatus?: "loading_model" | "recovering";
  contextWindowTokens?: number;
  now?: () => Date;
  // Fired synchronously right before each candidate's loadModel() call, with
  // its zero-based position in the list. Lets the UI show "Trying a lighter
  // model" once attemptIndex > 0, without this module knowing anything about
  // React state.
  onAttempt?: (candidate: ModelLoadCandidate, attemptIndex: number) => void;
}

// Walks an ordered candidate list — typically [selectedModel,
// ...fallbackModels] from a RouterDecision — trying each in turn and
// stopping at the first successful load. The list is already bounded by the
// router (maxFallbacks), so this never retries a model or loops unbounded.
// Records one technical-only load observation per attempt, success or
// failure, so future routing decisions see what actually happened on this
// device (see docs/privacy.md — never the prompt or response).
//
// This is intentionally unaware of runtime-replacement epochs or in-flight
// generation guards; the caller (AppRuntimeProvider) is responsible for that,
// exactly as it already is for the single loadModel() call it replaces.
export async function attemptModelLoadWithFallback(
  runtime: InferenceRuntime,
  candidates: readonly ModelLoadCandidate[],
  options: AttemptModelLoadOptions = {}
): Promise<AttemptModelLoadResult> {
  const now = options.now ?? (() => new Date());
  const seen = new Set<string>();
  const attemptedRegistryIds: string[] = [];
  const failedRegistryIds: string[] = [];
  let attemptIndex = 0;

  for (const candidate of candidates) {
    if (seen.has(candidate.webllmModelId)) continue;
    seen.add(candidate.webllmModelId);

    options.onAttempt?.(candidate, attemptIndex);
    attemptIndex += 1;
    attemptedRegistryIds.push(candidate.registryId);

    const startedAt = now().getTime();
    await runtime.loadModel(candidate.webllmModelId, {
      initialStatus: options.initialStatus,
      contextWindowTokens: options.contextWindowTokens,
    });
    const state = runtime.getState();
    const succeeded = state.status === "ready" && state.modelId === candidate.webllmModelId;

    recordModelPerformanceObservation(
      buildLoadObservation({
        modelId: candidate.registryId,
        succeeded,
        loadTimeMs: now().getTime() - startedAt,
        errorCode: succeeded ? undefined : (state.error?.code as RuntimeErrorCode | undefined),
        now,
      })
    );

    if (succeeded) {
      return {
        registryId: candidate.registryId,
        webllmModelId: candidate.webllmModelId,
        succeeded: true,
        attemptedRegistryIds,
        failedRegistryIds,
      };
    }
    failedRegistryIds.push(candidate.registryId);
  }

  return { registryId: null, webllmModelId: null, succeeded: false, attemptedRegistryIds, failedRegistryIds };
}

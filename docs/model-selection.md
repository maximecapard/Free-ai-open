# Model selection strategy

## Inputs

The router uses:

- device tier;
- WebGPU/WASM availability;
- task category;
- performance mode;
- model registry metadata;
- estimated RAM/download size;
- model status;
- license status;
- past local failures.

The public router API accepts:

- task;
- performance mode;
- device profile;
- model registry.

It returns:

- selected model;
- fallback model;
- rejected models with explicit technical reasons;
- reason code;
- human-readable reason.

## Router functions

- `selectRecommendedModel()` returns the full routing decision.
- `getFallbackModel()` returns the next compatible ranked model when available.
- `explainModelDecision()` returns the technical reason code and human-readable explanation.
- `rankCompatibleModels()` ranks already compatible models deterministically.
- `rejectIncompatibleModels()` rejects blocked, unsupported, too-heavy, or unavailable-backend models.

## Modes

### Fast

Prioritize low memory, short load time, high compatibility.

### Balanced

Prioritize the best fit for daily use.

### Performance

Prioritize stronger models when the device tier allows it.

## Task categories

- chat
- writing
- rewrite
- summarization
- translation
- coding
- learning
- document_analysis

## Manual selection

Advanced users can bypass recommendations and select a model manually, but the UI must still show warnings for unsupported or experimental models.

## v0.7.0-alpha — Adaptive Model Router v1 (complete)

Everything above describes the legacy v0.6 router (`selectRecommendedModel()`). As of Phase 4, the active app uses the adaptive v0.7 core (`routeAdaptiveModel()`) for real chat routing. The legacy types/helpers remain available for compatibility tests, but `/debug` and the runtime now read the same live adaptive decision:

- `routeAdaptiveModel()` consumes task, locale, mode, coarse capability, optional benchmark, recent technical observations, cached model IDs, registry version, and optional manual model ID. It never accepts conversation text.
- `ModelRegistryRecord` in `@free-ai-open/model-registry` (`schema-v2.ts`) — a strict per-model schema (verification status, sourced estimates, context presets, per-language/task/form-factor/mode suitability scores, minimum capability gates, license metadata, cycle-free fallbacks). `modelRegistryV2` now contains five records verified with WebLLM `0.2.84`; only fully verified records are eligible for automatic routing.
- `StaticCapabilityProfile`, `LocalBenchmarkResult`, and `ModelPerformanceObservation` in `@free-ai-open/types` — the capability, benchmark, and real-observation inputs the router combines. All three are now populated locally: observations are written from real `ai-runtime` load/generation outcomes (technical-only, keyed by registry model ID) as of Phase 4. The benchmark does not itself recommend or load a model.

The implementation validates Registry v2, rebuilds capability data from strict coarse allowlists, normalizes stale or malformed technical signals, then applies hard gates before scoring. Definite backend, feature/limit, memory, form-factor, metadata, task, repeated OOM, repeated stall, or repeated device-loss incompatibilities cannot be overridden by mode or cache. Eligible models are ranked by recent observed behavior, capability/benchmark fit, task, language, mode intent, and a deliberately small cache/download factor. Load attempts and generation outcomes use separate denominators, user cancellations are excluded from failure rates, stale observations are ignored, and exact internal weights remain adjustable rather than a permanent product promise.

Fallbacks follow validated registry edges, include eligible models only, become progressively no heavier, and stop after an explicit maximum. Manual selection can choose an eligible model and receives marginal-choice warnings; it cannot bypass hard gates. Fast uses conservative token presets, Balanced avoids treating the largest eligible model as automatically best, and Performance requires stronger evidence before returning the largest context/output preset.

As of Phase 4, the active runtime uses `RouterDecision` for real model loading and switching, and `/debug` translates its reason/warning/rejection codes into plain language. A `RouterDecision`'s model IDs are registry IDs, distinct from the WebLLM model IDs `ai-runtime`'s `loadModel()` expects — `apps/web/app/_runtime/routingOrchestration.ts` bridges the two everywhere a decision turns into an actual load. `recommendedContextTokens` is applied when creating the WebLLM engine and is capped by verified registry presets; `recommendedMaxOutputTokens` can only tighten the global generation-safety cap.

As of Phase 5, `/settings` exposes automatic (recommended) and manual model selection: manual selection sets `RouterInput.manualModelId`, and the router's own `manual_model_unknown`/`manual_model_ineligible` warnings (never a hard override of the eligibility gates) surface as a plain-language chat notice when a manual pick can no longer be honored. Manual controls remain disabled until the first capability-backed decision exists. Normal `/chat` shows exactly one plain-language sentence only when the recommended model is actually loaded (`apps/web/app/_lib/friendlyRouteExplanation.ts`, priority-ordered from the decision's reason codes) rather than describing a pending recommendation as active; the full reason/warning/rejection breakdown stays on `/debug` and behind the manual picker's per-model disclosure.

An uncached model is downloaded automatically only if it is the compact model disclosed during first-run setup. Every other uncached model requires explicit confirmation. Fallback attempts are restricted to cached, explicitly approved, or first-run pre-disclosed candidates, and a declined or failed upgrade is not immediately offered/retried in a loop during the same session.

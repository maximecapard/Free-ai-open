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

## v0.7.0-alpha — Adaptive Model Router v1 (in progress)

Everything above describes the active v0.6 router (`selectRecommendedModel()`), which still makes every application routing decision today. The pure v0.7 adaptive core is complete but not connected to runtime model loading:

- `routeAdaptiveModel()` consumes task, locale, mode, coarse capability, optional benchmark, recent technical observations, cached model IDs, registry version, and optional manual model ID. It never accepts conversation text.
- `ModelRegistryRecord` in `@free-ai-open/model-registry` (`schema-v2.ts`) — a strict per-model schema (verification status, sourced estimates, context presets, per-language/task/form-factor/mode suitability scores, minimum capability gates, license metadata, cycle-free fallbacks). `modelRegistryV2` now contains five records verified with WebLLM `0.2.84`; only fully verified records are eligible for the future automatic router.
- `StaticCapabilityProfile`, `LocalBenchmarkResult`, and `ModelPerformanceObservation` in `@free-ai-open/types` — the capability, benchmark, and real-observation inputs the future router will combine. The first two are now populated locally; observation records remain future work. The benchmark does not itself recommend or load a model.

The implementation validates Registry v2, normalizes stale or malformed technical signals, then applies hard gates before scoring. Definite backend, feature/limit, memory, form-factor, metadata, task, repeated OOM, or repeated device-loss incompatibilities cannot be overridden by mode or cache. Eligible models are ranked by recent observed behavior, capability/benchmark fit, task, language, mode intent, and a deliberately small cache/download factor. User cancellations are excluded from failure rates, stale observations are ignored, and exact internal weights remain adjustable rather than a permanent product promise.

Fallbacks follow validated registry edges, include eligible models only, become progressively no heavier, and stop after an explicit maximum. Manual selection can choose an eligible model and receives marginal-choice warnings; it cannot bypass hard gates. Fast uses conservative token presets, Balanced avoids treating the largest eligible model as automatically best, and Performance requires stronger evidence before returning the largest context/output preset.

The active UI has not switched to `RouterDecision`, does not translate its reason codes yet, and does not automatically download the selected model. Phase 4 will wire local signals and runtime loading; Phase 5 will expose explanations and eligible manual selection.

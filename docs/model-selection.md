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

Everything above describes the active v0.6 router (`selectRecommendedModel()`), which still makes every routing decision today. `v0.7.0-alpha` is adding a more adaptive router in phases; Phases 0 through 2 are complete, without replacing the active router above:

- `RouterInput`/`RouterDecision` in `@free-ai-open/model-router` (`adaptiveRouterContracts.ts`) — the future router's input (task, locale, performance mode, static capability profile, optional local benchmark result, an observation history, cached/manual model IDs) and output (selected/fallback model IDs, confidence, human-readable reasons/warnings, recommended token budgets, a decision version).
- `ModelRegistryRecord` in `@free-ai-open/model-registry` (`schema-v2.ts`) — a strict per-model schema (verification status, sourced estimates, context presets, per-language/task/form-factor/mode suitability scores, minimum capability gates, license metadata, cycle-free fallbacks). `modelRegistryV2` now contains five records verified with WebLLM `0.2.84`; only fully verified records are eligible for the future automatic router.
- `StaticCapabilityProfile`, `LocalBenchmarkResult`, and `ModelPerformanceObservation` in `@free-ai-open/types` — the capability, benchmark, and real-observation inputs the future router will combine. The first two are now populated locally; observation records remain future work. The benchmark does not itself recommend or load a model.

The intended scoring approach (not implemented yet) runs hard compatibility gates first, then weighs observed stability/performance, capability/benchmark fit, task suitability, language suitability, performance-mode intent, and cache/download convenience. The active UI has not switched to these v2 records and does not automatically download a recommended model. See `docs/model-registry.md`, `docs/model-verification.md`, and `docs/roadmap.md` for the current evidence and remaining phases.

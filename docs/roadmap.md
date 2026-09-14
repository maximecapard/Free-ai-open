# Roadmap

## Status during v0.7.0-alpha phased development

Local conversation history (store + `/chat` history sidebar) shipped in `v0.5.0-alpha`. Local conversation export/import is implemented end-to-end, including the `/chat` UI (export current, export all, import with a result summary). The app now has English/French UI coverage across public surfaces, a best-effort runtime-only language instruction for local model responses, a light/dark/system theme toggle, a completed product-wide redesign on the FreeAI Open brand system (`--fo-*` design tokens, a responsive app shell with a compact Ink desktop nav rail and a fixed safe-area-aware mobile top bar, an Ink-forward `/debug` dashboard, a plain-language device-capability/runtime-status layer with technical detail behind disclosures, and a multiline chat composer), production PNG app icon/favicon assets, an accessible mobile conversation history drawer with a persistent fixed trigger button that stays reachable while scrolling, accessibility labels, alpha generation safety for unstable local model output, automatic runtime recycling after cancellation, buffered chat transcript rendering to reduce UI pressure during local streaming, and a device capability profile based on multiple coarse signals (form factor, memory class, CPU-concurrency class, WebGPU/backend) rather than RAM alone — a high-RAM mobile phone no longer receives the same tier as a desktop PC.

`v0.6.6-alpha` adds: a first-run "Getting Started" flow that persists the confirmed performance mode locally and is shown only once (until reset or site data is cleared); per-conversation usage selection, so each new chat asks what it's for instead of repeating a single upfront choice, with the answer stored on the conversation and preserved through export/import; a redesigned `/settings` page covering performance mode, language, theme, device re-check, and Getting-Started reset; a dedicated fixed-height desktop chat workspace with independently scrolling sidebar/transcript regions and an anchored composer; a contrast fix for the desktop navigation rail's selected language/theme control; and persistent application-level WebLLM runtime ownership so Chat -> Settings -> Chat and Chat -> Debug -> Chat keep the loaded local model instead of unmounting the worker. Active generation state is provider-owned, so a response can continue across internal route navigation when the browser allows it; hidden/background tabs may still be throttled by the platform. Settings saves performance-mode changes through the runtime provider, blocking the save while a generation, cancellation, or recovery is active.

`v0.7.0-alpha` is being built in phases (see "Adaptive Model Router v1" below); **Phases 0 through 6 are complete**. The global review hardened capability/diagnostic allowlists, observation aggregation, consent-safe fallbacks, context-window application, runtime orchestration, and live router UI/debug state. Remaining phases are acceptance testing and release. Next up:

- **Future brand work:** reconstruct the logo as a true vector source for press/high-resolution use. Current public assets are production PNGs generated from the local square icon source.
- **Future UX work:** extract the mobile top bar's small dropdown menu into a shared, reusable popover primitive if a third UI surface needs the same disclosure pattern; consider user-testing the plain-language device-capability wording and the "Quality" mode label once real users are available.
- **v0.7.0-alpha Phase 1B — Model Registry v2: complete.** Five real records, strict registry/fallback validation, exact WebLLM compatibility checks, sources/licenses, and browser smoke evidence are documented.
- **v0.7.0-alpha Phase 2 — Local Benchmark v1: complete.** A dedicated Worker produces cached, expiring `LocalBenchmarkResult` values with strict time/resource bounds and no remote transmission.
- **v0.7.0-alpha Phase 3 — Adaptive Router Core: complete.** Pure normalization, hard gates, observation aggregation, deterministic scoring, manual eligibility, token budgets, explainability codes, and bounded fallbacks are implemented and tested.
- **v0.7.0-alpha Phase 4 — Runtime integration: complete.** The persistent runtime computes a `RouterDecision` before the first load, reuses it while inputs are unchanged, switches only at safe moments, requires consent for undisclosed uncached models, applies bounded context/output presets, and records technical load/generation observations. `promptTokensPerSecond`/`generationTokensPerSecond` remain unavailable because the runtime does not expose tokenizer-backed counts; `device_lost` is still folded into the current out-of-memory error path.
- **v0.7.0-alpha Phase 5 — Router UI and advanced settings: complete.** `/settings` exposes automatic/manual model selection with friendly localized metadata and conservative pending eligibility, `/chat` distinguishes the loaded model from a pending recommendation, and `/debug` reads the provider's live adaptive decision/runtime state.
- **v0.7.0-alpha Phase 6 — global review: complete.** Strict allowlists now cover direct router input, profile/observation persistence, and diagnostic export; benchmark/profile matching and date validation are conservative; load/generation observations use correct denominators; repeated stalls affect routing; fallback downloads respect disclosure/consent; and the provider's routing lifecycle lives in a focused hook rather than a monolithic component.
- **Future:** as of v0.8.0-alpha Phase 1, `ai-runtime`'s `generate()` now surfaces real WebLLM tokenizer-backed counts (`GenerationRuntimeMetrics.usage`) and an overall (not decode-only) completion-token rate; wiring that into `ModelPerformanceObservation`'s own `promptTokensPerSecond`/`generationTokensPerSecond` fields remains future work, along with giving WebGPU device-loss its own distinct `RuntimeErrorCode` instead of folding it into `out_of_memory`, so the `device_lost` observation outcome becomes reachable.
- **Phase 4 complete:** the router uses validated French/multilingual metadata when French is selected, and `AppRuntimeProvider` now supplies the real UI locale and applies the resulting decision to the runtime.
- **Future:** transcript virtualization/windowing for very long imported conversations if real-device testing shows the buffered renderer is not enough.
- **Future:** client-side encrypted export.
- **Future:** optional Google Drive sync.
- **Future:** better/more transparent model selection.
- **v0.8.0-alpha Phase 0 -- Local Benchmarks & Performance Intelligence: contracts and architecture complete.** `ModelBenchmarkResult` and its persistence/compatibility contracts are defined (see "Local Benchmarks & Performance Intelligence" below and docs/architecture.md); the benchmark runner and the `/benchmarks` page are not implemented yet.
- **v0.8.0-alpha Phase 1 -- runtime-backed performance metrics complete.** `@free-ai-open/ai-runtime` now captures accurate, runtime-verified load/TTFT/generation-duration/exact-token-usage measurements per generation (see "Local Benchmarks & Performance Intelligence" below and docs/architecture.md); still no benchmark runner, `/benchmarks` page, or router-scoring wiring.

None of the "Future" items above are implemented yet. See the detailed phases below for full scope.

## Adaptive Model Router v1 (v0.7.0-alpha phases)

A narrower, sequential breakdown of `v0.7.0-alpha` itself, distinct from the overall project phases below.

0. Contracts and architecture — **complete**. Types, package boundaries, local persistence/migration, documentation.
1A. Capability Profiler v2 — **complete**. Real local `StaticCapabilityProfile` detection with coarse GPU classes and confidence.
1B. Model Registry v2 — **complete**. Five verified `ModelRegistryRecord` entries, strict validation, source/license evidence, and a browser smoke matrix.
2. Local Benchmark v1 — **complete**. Real local `LocalBenchmarkResult` measurement.
3. Adaptive Router Core — **complete**. Real `RouterInput` → `RouterDecision` scoring.
4. Runtime integration — **complete**. Wires the router into `AppRuntimeProvider`; sources real `ModelPerformanceObservation`s from `ai-runtime`.
5. Router UI and advanced settings — **complete**. Public-facing plain-language recommendation, automatic/manual model selection, and richer status/empty-state wording.
6. Global review — **complete**.
7. Acceptance testing on desktop and mobile.
8. Merge and tag `v0.7.0-alpha`.

Non-goals for this version: no user accounts, no cloud sync, no remote storage of hardware profiles, no unique hardware identifier, no benchmark transmission, no prompt/response/document/conversation content in technical logs, no mandatory exact-VRAM estimate, no model choice based on RAM or GPU name alone, and no silent large-model download without informing the user first.

## Local Benchmarks & Performance Intelligence (v0.8.0-alpha phases)

A narrower, sequential breakdown of `v0.8.0-alpha` itself, distinct from the overall project phases below and from the `v0.7.0-alpha` "Adaptive Model Router v1" phases above. This is user-visible MODEL performance benchmarking (how fast does THIS model load/generate on THIS device/browser) -- not the existing generic device/WebGPU compute microbenchmark (`LocalBenchmarkResult`, still v0.7.0-alpha Phase 2 and unchanged by this work), and not a replacement for it.

0. Contracts and architecture — **complete**. `@free-ai-open/types`' `ModelBenchmarkResult` contract (schema, metric semantics, stability classification), the new `@free-ai-open/model-benchmark` package (versioned local IndexedDB persistence with atomic insert-and-prune, migration/expiry/invalidation, an in-memory fallback, compatibility-check helpers, and a pure evidence-aggregation contract for a future router phase to consume), a dependency-boundary test, and documentation. No benchmark runner, no `/benchmarks` page, and no router-scoring wiring yet — see docs/architecture.md's "Local model benchmarking" section for the defined-but-not-yet-implemented relationship to the adaptive router.
1. Runtime-backed performance metrics — **complete**. `@free-ai-open/ai-runtime` now captures the most accurate measurements the installed WebLLM runtime (verified: `@mlc-ai/web-llm` 0.2.84) actually supports per generation: exact tokenizer-backed token counts (via `stream_options: {include_usage: true}`) when the runtime reports them, TTFT from the same raw stream chunk the generation watchdog already reads, and generation duration — attached to `generate()`'s terminal chunk as `GenerationRuntimeMetrics`, a package-local shape a future runner will translate into the contract above. Does not itself drive a benchmark run, persist anything, or touch the router. See docs/architecture.md's "Phase 1: runtime-backed performance metrics" section.
2. Benchmark runner — **not started**. Drive `@free-ai-open/ai-runtime` through one bounded "quick"-preset run (load, first token, a short generation) and produce a `ModelBenchmarkResult` from the `GenerationRuntimeMetrics` Phase 1 now provides, cancellable, with a strict maximum duration, never interfering with an active user generation, never silently downloading a large uncached model without disclosure.
3. `/benchmarks` page — **not started**. A simple, consumer-friendly UI ("Model load time", "Time to first response", "Generation speed", "Stability", "Tested on this browser", "Results can vary") with technical fields available on demand, never as the primary surface.
4. Router integration — **not started**. Benchmark evidence (via `summarizeModelBenchmarkEvidence()`'s `BenchmarkEvidenceSummary`) becomes additional router input alongside real usage `ModelPerformanceObservation`s, never a replacement for them and never able to instantly override a hard eligibility gate; stale or incompatible evidence (contract version, registry, WebLLM, or device/browser mismatch) is ignored outright, never down-weighted. See docs/architecture.md's "Router relationship" section.
5. `standard`/`extended` presets — **not started**, if still wanted once "quick" has real usage evidence of its own value.

Non-goals for this version: no benchmark "quality"/answer grading with subjective prompts (this is a performance/stability measurement, not a model-answer evaluation), no cloud benchmark upload, no accounts, no server inference, no unique hardware/device fingerprinting beyond the existing coarse allowlisted classes, and no persisted benchmark prompt/response content.

## Phase 0 — Project setup

- Next.js scaffold
- TypeScript strict
- Tailwind/shadcn setup
- Internal contributor/agent instructions (kept local-only)
- docs baseline
- package structure
- CI baseline

## Phase 1 — Local AI prototype

- Integrate WebLLM
- Web Worker runtime boundary
- One compatible lightweight model
- Basic chat UI
- Streaming responses
- Stop generation
- Runtime error handling

## Phase 2 — Consumer UX

- Onboarding
- Fast / Balanced / Performance mode
- Task categories
- User-friendly model names
- Manual advanced selection

## Phase 3 — Device Profiler + Model Router

- Detect WebGPU/WASM
- Estimate device tier
- Model registry
- Router rules
- Fallback decisions
- Router explanation

## Phase 4 — Logging + telemetry

- Structured local logger
- Privacy redactor
- Redacted telemetry endpoint
- Supabase telemetry tables
- Debug report export
- `/debug` dashboard

## Phase 5 — Security hardening

- CSP
- Headers
- Hash/checksum model manifests
- Server validation
- Rate limiting
- Threat model
- Security docs

## Phase 6 — Local backup

- Versioned local JSON export/import helpers
- Export history UI
- Import history UI
- Future encrypted backup format
- Schema migration tests

## Phase 7 — Benchmarks

Contracts and architecture for this phase are now defined -- see "Local Benchmarks & Performance Intelligence (v0.8.0-alpha phases)" above. The runner and page below remain unimplemented.

- `/benchmarks` page
- tokens/sec
- load time
- first token
- browser compatibility

## Phase 8 — Google Drive sync

- Optional Google auth
- limited scopes
- client-side encryption
- Drive backup/restore

## Phase 9 — Model mirror

- Cloudflare R2
- browser-optimized model variants
- manifests
- hashes
- public benchmarks

## Phase 10 — Desktop

- PWA first
- Tauri desktop app
- larger local models
- better storage controls

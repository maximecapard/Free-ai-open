# Roadmap

## Status during v0.7.0-alpha phased development

Local conversation history (store + `/chat` history sidebar) shipped in `v0.5.0-alpha`. Local conversation export/import is implemented end-to-end, including the `/chat` UI (export current, export all, import with a result summary). The app now has English/French UI coverage across public surfaces, a best-effort runtime-only language instruction for local model responses, a light/dark/system theme toggle, a completed product-wide redesign on the FreeAI Open brand system (`--fo-*` design tokens, a responsive app shell with a compact Ink desktop nav rail and a fixed safe-area-aware mobile top bar, an Ink-forward `/debug` dashboard, a plain-language device-capability/runtime-status layer with technical detail behind disclosures, and a multiline chat composer), production PNG app icon/favicon assets, an accessible mobile conversation history drawer with a persistent fixed trigger button that stays reachable while scrolling, accessibility labels, alpha generation safety for unstable local model output, automatic runtime recycling after cancellation, buffered chat transcript rendering to reduce UI pressure during local streaming, and a device capability profile based on multiple coarse signals (form factor, memory class, CPU-concurrency class, WebGPU/backend) rather than RAM alone — a high-RAM mobile phone no longer receives the same tier as a desktop PC.

`v0.6.6-alpha` adds: a first-run "Getting Started" flow that persists the confirmed performance mode locally and is shown only once (until reset or site data is cleared); per-conversation usage selection, so each new chat asks what it's for instead of repeating a single upfront choice, with the answer stored on the conversation and preserved through export/import; a redesigned `/settings` page covering performance mode, language, theme, device re-check, and Getting-Started reset; a dedicated fixed-height desktop chat workspace with independently scrolling sidebar/transcript regions and an anchored composer; a contrast fix for the desktop navigation rail's selected language/theme control; and persistent application-level WebLLM runtime ownership so Chat -> Settings -> Chat and Chat -> Debug -> Chat keep the loaded local model instead of unmounting the worker. Active generation state is provider-owned, so a response can continue across internal route navigation when the browser allows it; hidden/background tabs may still be throttled by the platform. Settings saves performance-mode changes through the runtime provider, blocking the save while a generation, cancellation, or recovery is active.

`v0.7.0-alpha` is being built in phases (see "Adaptive Model Router v1" below); **Phases 0 through 4 are complete**. `AppRuntimeProvider` now computes a `RouterDecision` before the first model load and applies it: safe model switching with download consent, and real observation recording from `ai-runtime`. Router UI (manual override, richer in-chat explanations) remains Phase 5. Next up:

- **Future brand work:** reconstruct the logo as a true vector source for press/high-resolution use. Current public assets are production PNGs generated from the local square icon source.
- **Future UX work:** extract the mobile top bar's small dropdown menu into a shared, reusable popover primitive if a third UI surface needs the same disclosure pattern; consider user-testing the plain-language device-capability wording and the "Quality" mode label once real users are available.
- **v0.7.0-alpha Phase 1B — Model Registry v2: complete.** Five real records, strict registry/fallback validation, exact WebLLM compatibility checks, sources/licenses, and browser smoke evidence are documented.
- **v0.7.0-alpha Phase 2 — Local Benchmark v1: complete.** A dedicated Worker produces cached, expiring `LocalBenchmarkResult` values with strict time/resource bounds and no remote transmission.
- **v0.7.0-alpha Phase 3 — Adaptive Router Core: complete.** Pure normalization, hard gates, observation aggregation, deterministic scoring, manual eligibility, token budgets, explainability codes, and bounded fallbacks are implemented and tested.
- **v0.7.0-alpha Phase 4 — Runtime integration: complete.** `AppRuntimeProvider` computes a `RouterDecision` before the first load, recomputes only at real routing moments (task/locale/mode change, or the current model repeatedly failing), switches models safely (never mid-generation, never a silent non-default download), and records real `ModelPerformanceObservation`s from `ai-runtime` load/generation events. `promptTokensPerSecond`/`generationTokensPerSecond` are not populated yet — `ai-runtime`'s `generate()` doesn't currently surface real token counts from WebLLM — and the `device_lost` observation outcome is defined but currently unreachable, since `ai-runtime`'s error classifier maps WebLLM's `DeviceLostError` to `out_of_memory` rather than a distinct code. Both are candidates for a future refinement rather than blockers.
- **v0.7.0-alpha Phase 5 — Router UI and advanced settings:** expose the router's plain-language recommendation and reasons, with technical detail (reason codes, rejected models, confidence) behind a disclosure, plus manual override for eligible models. `RouterInput.manualModelId` is already wired through Phase 4's runtime integration and stays `undefined` from the app layer until this phase builds the picker.
- **Future (v0.7, superseded by the phases above once complete):** source real measured local performance (tokens/sec, load time, first-token time, recent failure count) from `@free-ai-open/local-logs` history and pass it into the device profiler so actual performance — not just coarse signals — can promote or demote a device's tier over time. The profiler already accepts this input; no caller supplies it yet.
- **Future (v0.7, superseded by the phases above once complete):** use the refined device tier (and `formFactor`) in `model-router` to prefer mobile-compatible/lightweight models on capped-tier devices and balanced/performance models on promoted ones.
- **Phase 4 complete:** the router uses validated French/multilingual metadata when French is selected, and `AppRuntimeProvider` now supplies the real UI locale and applies the resulting decision to the runtime.
- **Future:** transcript virtualization/windowing for very long imported conversations if real-device testing shows the buffered renderer is not enough.
- **Future:** client-side encrypted export.
- **Future:** optional Google Drive sync.
- **Future:** better/more transparent model selection.
- **Future:** benchmarks page.

None of the "Future" items above are implemented yet. See the detailed phases below for full scope.

## Adaptive Model Router v1 (v0.7.0-alpha phases)

A narrower, sequential breakdown of `v0.7.0-alpha` itself, distinct from the overall project phases below.

0. Contracts and architecture — **complete**. Types, package boundaries, local persistence/migration, documentation.
1A. Capability Profiler v2 — **complete**. Real local `StaticCapabilityProfile` detection with coarse GPU classes and confidence.
1B. Model Registry v2 — **complete**. Five verified `ModelRegistryRecord` entries, strict validation, source/license evidence, and a browser smoke matrix.
2. Local Benchmark v1 — **complete**. Real local `LocalBenchmarkResult` measurement.
3. Adaptive Router Core — **complete**. Real `RouterInput` → `RouterDecision` scoring.
4. Runtime integration — **complete**. Wires the router into `AppRuntimeProvider`; sources real `ModelPerformanceObservation`s from `ai-runtime`.
5. Router UI and advanced settings — public-facing recommendation, reasons, and manual override.
6. Global review.
7. Acceptance testing on desktop and mobile.
8. Merge and tag `v0.7.0-alpha`.

Non-goals for this version: no user accounts, no cloud sync, no remote storage of hardware profiles, no unique hardware identifier, no benchmark transmission, no prompt/response/document/conversation content in technical logs, no mandatory exact-VRAM estimate, no model choice based on RAM or GPU name alone, and no silent large-model download without informing the user first.

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

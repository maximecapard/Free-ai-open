# Architecture

## High-level design

```txt
Browser
├─ Next.js client UI
├─ WebLLM/WebGPU runtime in Web Worker
├─ IndexedDB local conversations
├─ Local JSON conversation export/import helpers
├─ Cache Storage / model cache
├─ Local logs
└─ Redacted telemetry client
       ↓
Netlify /api/telemetry
       ↓
Validation + redaction
       ↓
Technical telemetry persistence (planned)
```

## Data boundary

Private data stays in the browser:

- conversations;
- prompts;
- responses;
- uploaded documents;
- local preferences;
- local debug logs.

Server data is technical only:

- telemetry events;
- compatibility reports;
- model registry metadata;
- security events;
- public feedback.

## Packages

- `ai-runtime`: browser inference types/wrapper, runtime-only language instruction injection, stop/reload/recovery states, and alpha generation safety limits.
- `device-profiler`: capability estimation.
- `model-router`: task/mode/device based model selection.
- `model-registry`: model metadata and validation.
- `local-storage`: IndexedDB and local persistence.
- `conversation-store`: local-only browser conversation persistence, including an optional per-conversation `task` (usage/purpose) field.
- `conversation-export`: versioned local JSON conversation export/import helpers, preserving the optional `task` field under the same `freeai-open-conversations` version `1` format.
- `logger`: structured local logs.
- `privacy-redactor`: removes sensitive data.
- `telemetry`: event schemas and client/server helpers.
- `server-data`: placeholder for future server-side technical data persistence.

## Client/server rule

Browser-only code must never run in Server Components.

Browser-only APIs include:

- WebGPU;
- WebLLM;
- IndexedDB;
- Cache Storage;
- Web Workers;
- navigator APIs.

## UI language and theme

Translation and theme are app-level (`apps/web`) concerns, not packages, since they are tightly coupled to this app's specific UI strings and design tokens.

- Language: plain per-locale dictionaries (`apps/web/app/_i18n/locales/en.ts`, `fr.ts`) looked up through a small `useTranslations()` React context (`apps/web/app/_i18n`). No translation service or API call is involved; dictionaries ship as static data in the client bundle. The active locale defaults to the browser's language on first visit and is persisted in `localStorage`.
- Model response language: before local inference, `apps/web` passes the selected locale to `ai-runtime`, which adds a hidden system message to the WebLLM message list. This message is runtime-only: it is not conversation-store data, not displayed, not exported, not included in diagnostics, and not written to local logs. Language adherence is best effort and depends on model capability.
- Brand/design tokens: `apps/web/app/globals.css` defines the `--fo-*` token foundation from the FreeAI Open brand guide: source palette, semantic surfaces, text, borders, accent/focus, radii, spacing, typography, and motion durations. Existing `--color-*` variables remain as compatibility aliases; every current app surface (home, onboarding, chat, history, debug, settings) has been migrated onto the `--fo-*`/`.fo-*` foundation. Light-mode semantic text tokens deliberately separate visual brand teal from small text: `--fo-accent` can stay on the brighter brand teal for accents, while `--fo-accent-text` uses a darker accessible teal for normal-size labels, helper text, and badges.
- Application shell: `apps/web/app/_components/Header.tsx` renders a compact, always-Ink navigation rail on desktop and a compact fixed, safe-area-aware top bar with a small dropdown menu on mobile, both from the same markup — CSS alone (the same 720px breakpoint used by the chat drawer) decides which is visible. `apps/web/app/layout.tsx` wraps it and `{children}` in `.app-shell`/`.app-shell__content`. The rail/top bar are deliberately dark (`--fo-ink-950`) regardless of the selected theme, so the navigation chrome reads as stable structure while the main content area follows the theme normally. `/debug` uses the same technique for its whole page (see `.fo-ink-surface` in `globals.css`): rather than a separate "ink" variant of every class, `.fo-ink-surface` overrides the semantic `--fo-*` custom properties themselves within that subtree, so any existing token-based class or component resolves to the correct ink-forced colors automatically.
- Theme: CSS custom-property color tokens defined in `globals.css` for dark (default) and light, toggled via a `data-theme` attribute on `<html>` set by a `useTheme()` React context (`apps/web/app/_theme`) and persisted in `localStorage`. "System" leaves the attribute unset and relies on a `prefers-color-scheme` media query. A blocking inline script in the root layout applies a stored light/dark choice before hydration to avoid a flash of the wrong theme.
- Brand assets: production web PNGs live under `apps/web/public/brand/` and are referenced by the app metadata and compact navigation. Source brand files stay local-only under `.local/brand-source/` and are not part of the public repository. A true vector logo source is still future brand work.
- Neither system sends data to a server or stores anything beyond a small preference value (locale or theme name) in `localStorage`.

## First-run setup and per-conversation task

`apps/web/app/_lib/gettingStartedPreference.ts` is a single, schema-versioned `localStorage` record (`free-ai-open:getting-started`) holding whether the first-run "Getting Started" flow has been completed, the confirmed `PerformanceMode`, and an optional coarse device snapshot (`deviceTier`, `webgpuAvailable`, `formFactor`) kept only to explain the choice later — never raw sensor values. It follows the same window-guarded/try-catch convention as `themePreference.ts`/`localePreference.ts`, but bundles the whole flow's state in one record (rather than one key per field) since "has setup finished" and "what mode was chosen" are the same decision.

`/` and `/chat` both call `isGettingStartedCompleted()` on mount and redirect to `/onboarding` when it is false, so the first-run flow is shown automatically rather than offered as an optional shortcut. `/onboarding` now has two steps: device detection (`/onboarding/device`, unchanged) and performance-mode confirmation (`/onboarding/mode`, rewritten). The previous third step, `/onboarding/task`, is removed — task selection moved to per-conversation (see below) since asking for it once during setup no longer matched how the product is used. Confirming a mode calls `completeGettingStarted(mode, deviceSnapshot)` and navigates straight to `/chat`; the mode can be changed later from `/settings`, which calls `setStoredPerformanceMode()` directly without touching the completion flag, and can reset the whole flow via `resetGettingStarted()`.

Each conversation now carries its own optional `task` (a `TaskCategory` value) in `ConversationMetadata`, set once when the conversation is created and never changed afterward. Selecting "New chat" opens `apps/web/app/_components/NewChatTaskDialog.tsx`, a small accessible modal (focus trap via a Tab/Shift+Tab keydown handler scoped to the dialog's own focusable elements, Escape and backdrop-click to close, background scroll lock while open, focus restored to whatever element was previously focused) that asks what the conversation is for using `apps/web/app/_lib/catalog.ts`'s existing `TaskCategory` catalog — never a separate list. `newChatTaskOptions` filters out `document_analysis`, since the product has no document upload/analysis entry point yet and offering it would promise a capability that doesn't exist. Selecting a task creates the conversation with that task already set, opens it, and closes the dialog; the performance mode is never re-asked here, since it is a global preference, not a per-conversation one.

`/chat` reads the performance mode from `gettingStartedPreference` and the active conversation's task from its own metadata (`resolveConversationTask()` in `catalog.ts` defaults a missing/invalid value to `"chat"`, covering conversations created before this field existed and conversations imported from an older export). The model-router recommendation panel recomputes whenever either changes; the WebLLM worker/runtime lifecycle itself depends only on the performance mode being loaded, since this alpha always loads the same fixed compatibility model regardless of the router's advisory recommendation — task/mode changes therefore never reload the runtime or interrupt an in-progress generation.

## Desktop chat workspace layout

`/chat` has its own nested route layout, `apps/web/app/chat/layout.tsx`, which wraps the page in a `.chat-shell` div. This keeps the fixed-height, independently-scrolling treatment described below scoped to `/chat` alone — every other route continues to use the root layout's normal document-flow page scrolling untouched.

On desktop (`min-width: 721px`, the same breakpoint used everywhere else in the app), `globals.css` lets the root `.app-shell` own `height: 100dvh` for `/chat` while `.chat-shell` fills the remaining app-main height below any app-level runtime status strip. The conversation sidebar (`.chat-history-list`) and the message transcript (`.chat-main__scroll`) each get their own `overflow-y: auto` region, the composer (`.chat-main__composer`) stays `flex-shrink: 0` and anchored at the bottom, and every intermediate flex container along the chain is `min-height: 0` — the standard fix for a flex child otherwise refusing to shrink below its content's intrinsic height and defeating the inner `overflow-y: auto` regions. `ChatTranscript` measures the dedicated transcript scroll container on desktop and falls back to page scrolling on mobile. The page footer is hidden only on this route, and only inside the same desktop media query, via `.app-shell__main:has(> .chat-shell) + .app-footer { display: none; }` — a `:has()` selector rather than JS route-awareness, since the footer would otherwise either get clipped or force the shell taller than the viewport.

Mobile is untouched: none of the rules above apply below the 721px breakpoint, so the existing off-canvas history drawer, normal page scrolling, and footer all render exactly as before this change.

## Persistent runtime ownership

`apps/web/app/_runtime/AppRuntimeProvider.tsx` is a client component mounted from the root application layout, inside the locale/theme providers and above normal route boundaries. It owns the WebLLM `Worker`, the `InferenceRuntime`, runtime subscriptions, active generation identifiers, the current in-memory transcript view, and the performance-mode transition API. `/chat` is now a view over this provider rather than the owner of the worker.

The provider loads the local model when the user first enters `/chat` with the saved Getting Started performance mode. A small legacy bridge still accepts valid `/chat?task=...&mode=...` links by recording the mode preference and, when no conversation is active yet, the task. New app flows no longer depend on query parameters. After the first load, normal internal navigation does not dispose the runtime:

- Chat -> Settings -> Chat keeps the loaded worker/model;
- Chat -> Debug -> Chat keeps the loaded worker/model;
- route component unmount is a no-op for runtime disposal;
- `document.visibilityState`/hidden-tab changes are not disposal triggers.

The public runtime status lifecycle remains `idle` (uninitialized/not started), `loading_model`, `ready`, `generating`, `cancelling`, `recovering`, and `error`. Explicit reload, performance replacement, and root disposal are internal lifecycle triggers rather than additional user-facing statuses.

Disposal is limited to explicit lifecycle events:

- the application root unmounts;
- the user explicitly reloads the model;
- recovery recycles a stuck or interrupted worker;
- a future performance/model transition actually requires replacing the worker/model.

The lifecycle controller (`persistentRuntimeLifecycle.ts`) wraps the existing bounded worker teardown helper, so replacement paths still call `runtime.dispose()` but always terminate the old worker within the configured grace period if unload hangs.

Active generation state is also provider-owned. Each generation carries a `generationId`, conversation ID, and assistant message ID; streamed chunks update the visible assistant message only while those identifiers still match. Returning to `/chat` therefore shows the current or completed response, while late chunks from stale generations are ignored. The final assistant response is persisted to `@free-ai-open/conversation-store` only after the existing completion rules allow it; stopped, timed-out, failed, or unstable partial output is still discarded instead of saved as a completed answer.

Changing global performance mode goes through `applyPerformanceMode()` on the provider. While the runtime is generating, cancelling, or recovering, Settings disables the save action and does not persist the new preference. All modes still use the same fixed compatibility model, so a valid mode change persists the local preference and updates recommendations without replacing the runtime. The policy has a separate replacement decision for the future v0.7 model-selection path.

Background browser execution is intentionally described as best effort. FreeAI Open does not unload the model merely because a tab becomes hidden, but browsers and mobile operating systems may still throttle or suspend background work.
## Runtime cancellation recovery

Stop/cancel is handled as a runtime lifecycle transition, not just a UI interruption:

1. `stopGeneration()` moves the runtime from `generating` to `cancelling` immediately and logs `inference.cancel.requested`.
2. A real abort confirmation logs `inference.cancelled`, but the interrupted runtime is not treated as safe/ready for a new generation.
3. The app enters `recovering`, records `runtime.recovery.started`, tears down the old worker with bounded termination, creates a new worker/runtime, and reloads the cached model.
4. The app returns to `ready` and logs `runtime.recovery.completed` only after the replacement runtime finishes loading the model.
5. If reload fails, the app records `runtime.recovery.failed` and exposes the existing Reload model action.

Late chunks or confirmations from an abandoned generation must not overwrite newer runtime state.

## Streaming render responsiveness

The WebLLM worker stream is not throttled or modified. Streaming responsiveness is handled at the UI boundary in `/chat`:

- `apps/web/app/_lib/streamingBuffer.ts` batches visible assistant-text updates with `STREAM_RENDER_INTERVAL_MS` so very small token chunks do not trigger a React render for every chunk.
- `apps/web/app/chat/page.tsx` still accumulates the full assistant text in memory for completion handling and local persistence decisions. The buffer controls only when the transcript receives visible text.
- Pending buffered text is flushed on normal completion, cancellation, runtime error, or disposal so no characters are lost and no timer updates a stale assistant bubble after the generation path finishes.
- `apps/web/app/_lib/chatAutoscroll.ts` keeps scroll-follow behavior based on "near bottom" metrics. The transcript schedules scroll work through `requestAnimationFrame` and stops forcing scroll when the user has moved away from the bottom.
- The history drawer/sidebar/export controls and individual message bubbles are memoized so unchanged regions do not rerender for each buffered transcript update; language and theme still flow through React context.

The buffering layer is in-memory UI state only. It does not write generated text to local technical logs, diagnostic reports, telemetry, or any server path. Transcript virtualization remains future work for very long imported conversations.

## Mobile navigation

Below a 720px viewport width, the `/chat` history panel (new chat, conversation list, rename/delete, export/import) is presented as an off-canvas drawer instead of a permanent block in the document flow:

- `apps/web/app/_lib/mobileHistoryDrawer.ts`: a pure reducer for the drawer's open/closed state, with distinct action types for each required closing trigger (open, close, toggle, selection, new chat, Escape, backdrop click, desktop viewport resize).
- `apps/web/app/_components/useMobileHistoryDrawer.ts`: a hook that wires the reducer to DOM behavior — Escape key handling, backdrop clicks, background scroll lock while open, focus transfer to the close button on open, background isolation with `inert` where supported, focus redirection back into the drawer if needed, focus restoration to the trigger button on close, and closing automatically if the viewport becomes desktop-sized.
- `apps/web/app/_components/ChatHistoryDrawerPanel.tsx`: wraps the existing `ChatHistorySidebar` (unchanged) with a backdrop, a mobile-only close button, and dialog semantics (`role="dialog"`, `aria-modal`, `aria-label`) that only apply at mobile viewport widths; the closed panel is marked `inert` on mobile so it isn't keyboard-reachable while off-screen.
- CSS in `globals.css` hides the trigger button, backdrop, and panel header by default and only shows them inside the existing `max-width: 720px` media query; the panel itself is a plain pass-through wrapper on desktop, so the fixed-width sidebar layout above that breakpoint is unchanged.

No JavaScript drives the desktop/mobile visual switch; a small `matchMedia` listener is used only to correct ARIA semantics and force-close the drawer if the viewport crosses the breakpoint while it's open.

The trigger button itself is `position: fixed` on mobile (top-right corner, offset by `env(safe-area-inset-top/right, 0px)`, above the drawer's own `z-index`), not just visually positioned in the heading row, so it stays reachable while scrolling through a long conversation instead of scrolling away with the page. `apps/web/app/layout.tsx` sets `viewport: { viewportFit: "cover" }` so those `env()` safe-area values actually resolve on notched/rounded-corner devices instead of silently evaluating to zero. `.chat-layout` gets matching top padding on mobile so the fixed button never overlaps the content underneath it, and the button toggles/hides itself while the drawer is open rather than staying visible above the open panel. Because the trigger is hidden while open, focus is moved into the drawer before the background is keyboard-reachable; closing through any existing close path restores focus to the trigger when it still exists.

## Device capability profiling

`@free-ai-open/device-profiler` builds a local, coarse capability profile used to pick a device tier (`0`–`4`, a plain `DeviceTier`) for `model-router`. As of v0.7.0-alpha Phase 1A, it also produces a `StaticCapabilityProfile` for the adaptive-router pipeline. This profile is still a static estimate: it uses browser-visible signals, never exact hardware specifications that the Web platform does not reliably expose.

The tier used to be derived almost entirely from `navigator.deviceMemory`, which classified any device with ≥8 GB of RAM as `webgpu_high` (tier 3) regardless of form factor — putting a 12 GB Android phone in the same tier as a desktop PC. The tier calculation is now a small, documented scoring model instead:

- `packages/device-profiler/src/capabilities.ts`: coarse, non-identifying detectors — `detectFormFactor` (`mobile`/`tablet`/`desktop`/`unknown`, from the UA-CH `mobile` hint and user-agent heuristics; the iPadOS desktop-style rule checks `Macintosh`/`Mac OS` plus `maxTouchPoints > 1` before generic macOS desktop classification, and contradictory hints fall back to `"unknown"`), `detectArchitectureClass` (`arm`/`x86`/`unknown`, from the Client Hints `getHighEntropyValues(["architecture"])` API when available — never guessed from OS family, since e.g. Apple Silicon Macs are ARM despite reporting `macos`), `classifyMemory`/`classifyCpuConcurrency` (bucket raw GB/core counts into `low`/`medium`/`high`/`unknown`), and `detectCpuConcurrency` (`navigator.hardwareConcurrency`).
- `packages/device-profiler/src/scoring.ts`: `getDeviceTier` gates tier `0` on WebGPU availability alone (unchanged from before — WASM-only devices stay at the most conservative tier). For WebGPU-capable devices, it sums small bounded points for memory class, CPU-concurrency class, and a fixed WebGPU baseline point (2 + 2 + 1 max — no single signal, least of all memory, can reach a high tier alone), then applies a **form-factor tier cap** (`mobile` capped at tier 2, `tablet` at 3, `unknown` at 3, `desktop` uncapped) so coarse signals alone can never place a phone alongside desktop-class hardware. An optional `measuredPerformance.tokensPerSecond` can promote a device above its cap (bounded by what the coarse signals already suggested), and a `measuredPerformance.recentFailureCount` of 2+ demotes the result by one tier, floored at tier 1.
- `DeviceProfile` now always includes `formFactor`, `architectureClass`, `memoryClass`, `cpuConcurrencyClass`, and an optional `measuredPerformance` echo. All of these are coarse, bounded categories or optional locally-supplied numbers — never a raw sensor value, a raw user-agent string, or anything that could act as a unique hardware fingerprint.
- `buildStaticCapabilityProfile()` produces the v0.7 `StaticCapabilityProfile` contract with schema version, detection/expiry timestamps, form factor, architecture class, browser/OS family, memory and logical-processor classes, WebGPU/WASM availability, fallback-adapter status, device tier, product-facing capability class (`compatibility`, `light`, `balanced`, `performance`), confidence, and a normalized `gpu` object.
- The normalized GPU object persists only coarse classes and buckets: vendor class (`nvidia`, `amd`, `intel`, `apple`, `qualcomm`, `arm`, `unknown`), broad architecture/description class, allowlisted feature classes, selected WebGPU limit buckets, fallback-adapter boolean, and optional low-confidence experimental memory bucket. Raw adapter strings, device IDs, driver strings, exact high-entropy limits, exact VRAM, and fingerprint hashes are never stored.
- The app writes this static capability profile through `apps/web/app/_lib/capabilityProfileStore.ts` when device detection runs on Home, onboarding, Settings, Debug, or the runtime provider. The store is schema-versioned, expires old profiles, and treats browser/OS-family changes as a reason to re-detect. Settings' existing "Re-check this device" action performs a fresh local detection.

### Plain-language presentation

`apps/web/app/_lib/deviceRecommendation.ts` adds `describeDeviceCapability(webgpuAvailable, deviceTier)`, a pure function mapping the raw tier to one of four public-facing categories ("Limited compatibility", "Suitable for lightweight models", "Recommended experience", "High-performance device") with boundaries that intentionally mirror `recommendPerformanceMode()`, so the label a user sees always matches the mode the app actually recommends. `apps/web/app/_components/DeviceCapabilitySummary.tsx` is the single shared presentational component (used on the home page and `/onboarding/device`) that shows this plain-language summary by default and keeps the raw tier/backend/memory/storage fields behind an "Advanced technical details" disclosure, matching the "simple by default, technical on demand" rule for the normal (non-technical) interface. `/debug` remains the one surface that shows raw technical values by default.

The home page's "Use the recommended setup" CTA also uses `apps/web/app/_lib/deviceRecommendation.ts` as its source of truth. Once `detectDeviceProfile()` resolves locally in the browser, `getRecommendedChatPath()` maps the current `DeviceProfile.deviceTier` to `/chat?task=chat&mode=<recommended>`. While profiling is still pending, the home page shows a detection state instead of hardcoding `balanced`. The `/onboarding/mode` recommendation badge consumes the same profile-to-mode helper, so home and onboarding cannot diverge without a test failure.

### Future router integration

`model-router` only ever reads `DeviceProfile.deviceTier` (a plain `0–4` number) and did not need any changes for this refinement. The clean integration point for v0.7 is `DeviceProfilerEnvironment.measuredPerformance` / `DeviceTierInput.measuredPerformance`: a caller (`apps/web`) can source `tokensPerSecond`, `modelLoadTimeMs`, `firstTokenTimeMs`, and `recentFailureCount` from its own recent `@free-ai-open/local-logs` history and pass them into `buildDeviceProfile()` before routing, letting real measured performance promote or demote a device's tier over time instead of relying on coarse signals alone. No caller wires this yet — `detectDeviceProfile()`'s default call leaves `measuredPerformance` unset rather than faking a measurement. Once wired, `model-router` can also start preferring mobile-compatible/lightweight models on capped-tier devices, balanced/performance models on promoted ones, and French-capable/multilingual models when French is selected, without any structural change to how it consumes the profile.

## v0.7.0-alpha — Adaptive Router v1 phases

**Status: Phases 0 through 5 are implemented.** `AppRuntimeProvider` computes a `RouterDecision` before the first model load and applies it — including safe model switching and real observation recording — and `/settings` now exposes automatic/manual model selection with a plain-language chat explanation. The legacy v0.6 router is used only by `/debug`'s independent side-by-side preview.

### Contract types and where they live

- `@free-ai-open/types` (`router-signals.ts`): `CapabilityConfidence` (`"low" | "medium" | "high"`, shared by every signal below), `StaticCapabilityProfile` (a device's static, non-benchmarked capability signals — form factor, architecture class, coarse memory/processor counts, WebGPU/WASM availability, and a `gpu` sub-object of coarse classes and bounded feature/limit maps, never a raw adapter string), `LocalBenchmarkResult` (a short local microbenchmark's outcome, with an `expiresAt` so a stale result can be treated as absent), and `ModelPerformanceObservation` (a single observed model load/generation outcome — technical timings and an outcome code, never prompt/response content).
- These four types live in `@free-ai-open/types` rather than in `device-profiler`/`ai-runtime`/a future `local-benchmark` package individually, specifically so every future producer (a capability detector, a benchmark runner, `ai-runtime`) and consumer (`model-router`) can share one contract without any of those packages depending on each other. In particular, `model-router` — meant to stay pure eligibility/scoring/fallback logic — never needs a dependency on the much heavier `ai-runtime` package (which pulls in `@mlc-ai/web-llm`) just to reference `ModelPerformanceObservation`.
- `FormFactor`/`ArchitectureClass` moved from `device-profiler` into `types` as part of this (device-profiler re-exports both, so every existing `import type { FormFactor } from "@free-ai-open/device-profiler"` call site is unaffected) — `StaticCapabilityProfile` reuses the exact same coarse categories as the existing `DeviceProfile` instead of a parallel duplicate definition.
- `@free-ai-open/model-router`: the adaptive implementation is split across normalization, observation aggregation, eligibility, scoring, fallback, and orchestration modules. `routeAdaptiveModel()` is pure and deterministic for a normalized input, registry version, and clock. Its stable reason/warning/rejection codes are translation-ready; the app does not consume them yet.
- `@free-ai-open/model-registry` (`schema-v2.ts`, `registry-v2.ts`, `registry-validation.ts`): `ModelRegistryRecord`, strict runtime validation, and five curated records verified with WebLLM `0.2.84`. Records carry sourced download/runtime estimates, ordered context presets, per-language/task/form-factor/performance-mode scores, capability gates, source/license metadata, known issues, and validated acyclic fallbacks. The package imports WebLLM only in tests to compare exact prebuilt IDs, URLs, libraries, features, and memory metadata; production registry code stays metadata-only. The legacy `ModelRecord`/`sampleModels` path remains active until router integration.

### Registry and runtime boundary

Model Registry v2 is preparation for adaptive selection, not the selector itself. It validates metadata at module initialization and exposes only fully verified records to future automatic-routing helpers. It does not inspect the device, load a model, download an artifact, persist a preference, or call the network. WebLLM remains behind the client-only `ai-runtime`/worker boundary.

The fixed runtime default changed from the tiny Phase 0 test model to the verified `SmolLM2-360M-Instruct-q4f32_1-MLC` compatibility record. As of Phase 4, this record also serves as the pre-disclosed fallback: the first load always reaches a working chat immediately (loading this record if the router's real pick needs consent first), and every subsequent switch resolves through `RouterDecision` — see "Phase 4 — Runtime integration" below.

### Persistence boundaries

Three local, schema-versioned preference stores live in `apps/web/app/_lib/`: `capabilityProfileStore.ts`, `benchmarkResultStore.ts`, and `modelObservationStore.ts`. Phase 2 writes strict allowlisted benchmark results and rejects stale, version-mismatched, profile-mismatched, or malformed records. Model-observation writers remain future work.

Matching the mission's recommended boundaries:

- **Session-only, never persisted:** raw GPU adapter strings, exact high-entropy limit maps, active benchmark buffers.
- **Persisted locally:** the coarse `StaticCapabilityProfile`/`LocalBenchmarkResult`/`ModelPerformanceObservation[]` shapes above, plus the existing `gettingStartedPreference` (performance mode) and per-conversation `task`.
- **In diagnostics:** coarse capability categories, benchmark version/status/score, selected model ID, router reason codes, technical observations — never expanded beyond what `/debug` already shows for v0.6 fields.
- **Never:** prompt, response, conversation, document content, a unique device fingerprint, or the hidden runtime-only language instruction.

### Local benchmark package boundary

`@free-ai-open/local-benchmark` depends only on `@free-ai-open/types`. It owns workload selection, deterministic WebGPU execution, scoring, stability classification, timeout/cancellation handling, and resource cleanup. `apps/web` owns Worker creation, local persistence, lifecycle logs, and UI. The package does not depend on or share a device with `ai-runtime`.

### Dependency graph verified for this phase

No new inter-package dependency edge was introduced: `types` remains a zero-workspace-dependency leaf; `device-profiler`, `model-registry`, and `model-router` already depended on it. `apps/web/app/_lib/packageDependencyBoundaries.test.ts` reads each package's real `package.json` and asserts this holds — including that `model-router` does not depend on `ai-runtime` and vice versa — so a future phase that does add a real edge gets a test failure if it accidentally creates a cycle.

### Phase 4 — Runtime integration

`apps/web/app/_runtime/AppRuntimeProvider.tsx` now owns the full routing lifecycle instead of unconditionally loading the fixed default:

- **Deciding.** `evaluateRouting()` builds a `RouterInput` (via `routingOrchestration.ts`'s `buildRouterInputContext()`, which reads the stored capability profile — detecting fresh only if none is valid — the stored benchmark for that profile, stored observations, and real per-model cache status) and calls `routeAdaptiveModel()`. It only recomputes when `apps/web/app/_lib/routingDecisionCache.ts`'s cache key actually changes (task, locale, performance mode, capability/benchmark timestamps, cached-model set, registry version, or whether the current model just crossed the repeated-fatal-failure threshold) — never before every message. The decision is kept in React state/refs only, never written to `localStorage`: it is cheap and deterministic to recompute from the already-persisted inputs.
- **ID spaces.** A `RouterDecision`'s `selectedModelId`/`fallbackModelIds` and every stored `ModelPerformanceObservation.modelId` are registry IDs (matching how `adaptiveRouter.ts` itself matches observations, `item.modelId === model.id`), but `InferenceRuntime.loadModel()`/`RuntimeState.modelId` are WebLLM model IDs. `routingOrchestration.ts`'s `buildLoadCandidatesFromDecision()`/`registryIdForWebllmModelId()` bridge the two spaces at every call site so a load is always requested by WebLLM ID while every recorded observation stays keyed by registry ID.
- **Switching.** `apps/web/app/_lib/modelSwitchPolicy.ts`'s `resolveModelSwitch()` decides what happens when the decision's pick differs from what's loaded: the same model is a no-op; a busy runtime (loading, generating, cancelling, or recovering) defers until the next routing moment; a cached model or the pre-disclosed default (`SmolLM2-360M-Instruct-q4f32_1-MLC`) switches immediately via `performModelSwitch()` (a `model_replacement` runtime-disposal trigger, reusing the existing safe worker-teardown path — see "Persistent runtime and navigation" in `docs/privacy.md`); anything else shows a `ModelDownloadConsent` prompt (friendly name, approximate size, that it runs locally) before anything downloads. The very first load applies the same rule: if the router's initial pick isn't the disclosed default and isn't cached, the default loads immediately so chat is usable right away, and a consent prompt offers the upgrade.
- **Loading with fallback.** `attemptModelLoadWithFallback()` walks `[selectedModelId, ...fallbackModelIds]` (already bounded by the router's own `maxFallbacks`), stopping at the first successful load and recording one technical load observation per attempt — success or failure — so it never silently retries a model and never loops unbounded.
- **Observations.** Load observations come from `attemptModelLoadWithFallback()`; generation observations are built in `sendMessage()` from locally measured wall-clock timing (`firstTokenTimeMs`, `generationDurationMs`) plus the stream's `stopReason`/error code, classified by `apps/web/app/_lib/performanceObservationBuilder.ts` (user cancellation is never recorded as a model failure; only completion/stall/OOM/degenerate outcomes are). `promptTokensPerSecond`/`generationTokensPerSecond` are not populated yet — `ai-runtime`'s `generate()` does not currently surface real token counts from WebLLM, and this builder deliberately does not approximate them from character counts, since that would feed noisy signal into future routing scores. `device_lost` is a defined observation outcome that this builder currently never produces, because `ai-runtime`'s error classifier maps WebLLM's `DeviceLostError` to `out_of_memory` rather than a distinct code.
- **Generation limits.** `RouterDecision.recommendedMaxOutputTokens` threads through to `ai-runtime`'s `generate({ maxOutputTokens })`, added as an optional field on `GenerateInput` that can only tighten — never raise — the existing `GENERATION_SAFETY_LIMITS.maxTokens` alpha cap. `recommendedContextTokens` is not separately enforced as a per-call truncation: the router already applies it via model/preset selection (`selectPreset()`, built in Phase 3), and the model's WebLLM-loaded config fixes its actual context capacity.
- **Cache detection.** `ai-runtime` gained `isModelCached()`, a thin wrapper over WebLLM's `hasModelInCache()`. It defaults to `false` (assume a download is needed) on any failure, since that direction only ever triggers an extra consent prompt rather than an undisclosed download.
- **Manual override.** `RouterInput.manualModelId` stays wired through every function used above; Phase 5 supplies it from the app layer — see "Phase 5 — Router UI" below.
- **Diagnostics.** `/debug` gained an adaptive-router panel (selected model, confidence, reason/warning codes translated via `apps/web/app/_lib/adaptiveRouteExplanation.ts`, fallback chain, rejected models with reasons, recommended context/output tokens, decision/registry version) and an observations summary (`apps/web/app/_lib/observationsSummary.ts`: total count, per-outcome and per-model breakdowns), both additive next to the existing, untouched v0.6 preview panel.

### Phase 5 — Router UI

The mission's principle: "simple by default, technical on demand." Every technical panel this phase adds is opt-in (`/settings`, `/debug`) or behind a `<details>` disclosure; the normal `/chat` surface gained only a one-line plain-language explanation and richer status wording.

- **Manual override.** A new local preference store, `apps/web/app/_lib/manualModelPreference.ts` (`{mode: "automatic" | "manual", manualModelId}`, schema-versioned, mirrors `gettingStartedPreference.ts`), is loaded into `AppRuntimeProvider` on mount and threaded into every `evaluateRouting()` call as `RouterInput.manualModelId`. `setManualModel()`/`setAutomaticModel()` persist the choice, update state, and immediately trigger a re-route + `applyModelSwitchIfNeeded()` — manual selection goes through the *same* consent flow as automatic routing (`resolveModelSwitch()`); picking a model by hand is not itself consent to download it, and the router still applies its own hard eligibility gates regardless of what was manually requested (warning rather than bypassing them if the pick turns out ineligible).
- **Manual model picker.** `apps/web/app/_components/ManualModelPicker.tsx` (used from `/settings`) lists an "Automatic — recommended" option plus one card per `modelRegistryV2` record: friendly name, approximate size, live cache status (`isModelCached()` per model), a technical-details disclosure (exact WebLLM ID, per-language suitability, recommended tasks, device suitability), and an experimental-status note. A card is disabled — not hidden — when `apps/web/app/_lib/manualModelEligibility.ts`'s `resolveManualModelEligibility()` finds the model in the latest `RouterDecision.rejectedModels`, showing the router's own rejection reasons; without a decision yet it fails open (never blocks a model the router hasn't actually evaluated). The selectable area and the details disclosure are structured as siblings, not nested — HTML forbids interactive content (`<details>`) inside a `<button>`.
- **Friendly recommendation line.** `apps/web/app/_lib/friendlyRouteExplanation.ts`'s `pickFriendlyRouteExplanation()` reduces a `RouterDecision.reasons[]` list to exactly one plain-language sentence via a fixed priority order (a fallback story first — it explains *why* the model just changed — then language match, task fit, speed/device-fit signals, then "already on this device"). Chat shows this one line next to the model status pill; the full reason/warning/rejection list stays on `/debug`.
- **Model status labels.** `apps/web/app/_lib/modelStatusLabel.ts`'s `resolveModelStatusKey()` adds the mission's named states — Choosing a local model, Download required, Preparing the local model, Trying a lighter model, Model unavailable — layered in front of the existing `runtimeStatusPlain` labels (idle/generating/cancelling/recovering keep their v0.6.6 wording). "Trying a lighter model" needs to know a fallback attempt is underway: `attemptModelLoadWithFallback()` gained an optional `onAttempt(candidate, attemptIndex)` callback, and `AppRuntimeProvider` flips an `isFallbackRetry` flag once `attemptIndex > 0`. None of these in-progress/consent-pending states are ever shown once a model is actually usable (ready/generating/cancelling) — a background re-route or a pending upgrade offer must never make the status pill claim chat is blocked.
- **Download consent refinements.** `PendingModelSwitch` gained `isMobileFormFactor` (read from the stored capability profile at the point a switch is offered); `apps/web/app/_lib/modelDownloadDisclosure.ts`'s `isLargeMobileDownload()` (≥500MB, deliberately lower than the router's own 1GB `download_large` warning threshold, since mobile data plans are commonly capped well below what a desktop connection tolerates) drives an extra warning line in `ModelDownloadConsent`.
- **Empty/error states.** `apps/web/app/_lib/chatEmptyState.ts`'s `resolveChatEmptyStateReason()` distinguishes three chat-relevant causes from a `RouterDecision`: every rejected model blocked specifically by `backend_unavailable` → a WebGPU-specific notice instead of the generic "no compatible model" one; a `manual_model_ineligible`/`manual_model_unknown` warning even though a fallback was still selected → a notice that the manual pick was overridden this time; otherwise the existing generic notice. A new `useOnlineStatus()` hook (`apps/web/app/_components/useOnlineStatus.ts`) adds an offline-specific line to the existing model-unavailable error banner when `navigator.onLine` is false.
- **Debug additions.** The Phase 4 adaptive-router panel gained per-model cache status (appended inline to the selected-model and fallback-chain display strings) and the real automatic/manual mode read from the same local preference store `/settings` uses — both computed from the debug page's own preview `RouterInput`, consistent with how it has always built an independent preview rather than reading live `AppRuntimeProvider` state.

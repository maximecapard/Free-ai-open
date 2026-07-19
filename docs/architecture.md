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

`/` and `/chat` both call `isGettingStartedCompleted()` on mount and redirect to `/onboarding` when it is false, so the first-run flow is shown automatically rather than offered as an optional shortcut. `/onboarding` has two steps: device detection plus an optional short benchmark (`/onboarding/device`, with cancel/skip) and performance-mode confirmation (`/onboarding/mode`). Before confirmation, the second step discloses the friendly compact compatibility model, its approximate first download size, local browser caching, and that every other uncached model requires separate consent. The previous third step, `/onboarding/task`, is removed — task selection moved to per-conversation (see below). Confirming a mode calls `completeGettingStarted(mode, deviceSnapshot)` and navigates straight to `/chat`; the mode can be changed later from `/settings`, which calls `setStoredPerformanceMode()` directly without touching the completion flag, and can reset the whole flow via `resetGettingStarted()`.

Each conversation now carries its own optional `task` (a `TaskCategory` value) in `ConversationMetadata`, set once when the conversation is created and never changed afterward. Selecting "New chat" opens `apps/web/app/_components/NewChatTaskDialog.tsx`, a small accessible modal (focus trap via a Tab/Shift+Tab keydown handler scoped to the dialog's own focusable elements, Escape and backdrop-click to close, background scroll lock while open, focus restored to whatever element was previously focused) that asks what the conversation is for using `apps/web/app/_lib/catalog.ts`'s existing `TaskCategory` catalog — never a separate list. `newChatTaskOptions` filters out `document_analysis`, since the product has no document upload/analysis entry point yet and offering it would promise a capability that doesn't exist. Selecting a task creates the conversation with that task already set, opens it, and closes the dialog; the performance mode is never re-asked here, since it is a global preference, not a per-conversation one.

`/chat` reads the performance mode from `gettingStartedPreference` and the active conversation's task from its own metadata (`resolveConversationTask()` in `catalog.ts` defaults a missing/invalid value to `"chat"`, covering conversations created before this field existed and conversations imported from an older export). Adaptive routing recomputes when task, locale, mode, capability/benchmark/cache evidence, or technical observations materially change. A model replacement is deferred while the runtime is busy and is a no-op when the selected model is already loaded, so a task/mode change never interrupts an in-progress generation.

## Desktop chat workspace layout

`/chat` has its own nested route layout, `apps/web/app/chat/layout.tsx`, which wraps the page in a `.chat-shell` div. This keeps the fixed-height, independently-scrolling treatment described below scoped to `/chat` alone — every other route continues to use the root layout's normal document-flow page scrolling untouched.

On desktop (`min-width: 721px`, the same breakpoint used everywhere else in the app), `globals.css` lets the root `.app-shell` own `height: 100dvh` for `/chat` while `.chat-shell` fills the remaining app-main height below any app-level runtime status strip. The conversation sidebar (`.chat-history-list`) and the message transcript (`.chat-main__scroll`) each get their own `overflow-y: auto` region, the composer (`.chat-main__composer`) stays `flex-shrink: 0` and anchored at the bottom, and every intermediate flex container along the chain is `min-height: 0` — the standard fix for a flex child otherwise refusing to shrink below its content's intrinsic height and defeating the inner `overflow-y: auto` regions. `ChatTranscript` measures the dedicated transcript scroll container on desktop and falls back to page scrolling on mobile. The page footer is hidden only on this route, and only inside the same desktop media query, via `.app-shell__main:has(> .chat-shell) + .app-footer { display: none; }` — a `:has()` selector rather than JS route-awareness, since the footer would otherwise either get clipped or force the shell taller than the viewport.

Mobile is untouched: none of the rules above apply below the 721px breakpoint, so the existing off-canvas history drawer, normal page scrolling, and footer all render exactly as before this change.

## Persistent runtime ownership

`apps/web/app/_runtime/AppRuntimeProvider.tsx` is a client component mounted from the root application layout, inside the locale/theme providers and above normal route boundaries. It owns the persistent runtime lifecycle, active generation identifiers, and current in-memory transcript view; focused `useAdaptiveRuntimeRouting.ts` owns adaptive decision/cache/consent/model-switch orchestration. `/chat` is a view over this provider rather than the owner of the worker.

The provider evaluates adaptive routing and loads the resulting safe candidate when the user first enters `/chat` with the saved Getting Started performance mode. A small legacy bridge still accepts valid `/chat?task=...&mode=...` links by recording the mode preference and, when no conversation is active yet, the task. New app flows no longer depend on query parameters. After the first load, normal internal navigation does not dispose the runtime:

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

Active generation state is also provider-owned. Each generation carries a `generationId`, conversation ID, and assistant message ID; streamed chunks update the visible assistant message only while those identifiers still match. Returning to `/chat` therefore shows the current or completed response, while late chunks from stale generations are ignored. The final assistant response is persisted to `@free-ai-open/conversation-store` only after the existing completion rules allow it; stopped or unstable partial output is still discarded instead of saved as a completed answer. As of v0.7.1-alpha, a genuine watchdog-detected timeout/stall that already produced visible text is the one exception — see "Generation timeout and stall watchdog" below.

Changing global performance mode goes through `applyPerformanceMode()` on the provider. While the runtime is generating, cancelling, or recovering, Settings disables the save action and does not persist the new preference. When idle, a valid change persists the local preference, recomputes the adaptive decision, and replaces the worker/model only if the selected model actually changes; the same-model case remains a no-op.

Background browser execution is intentionally described as best effort. FreeAI Open does not unload the model merely because a tab becomes hidden, but browsers and mobile operating systems may still throttle or suspend background work.
## Runtime cancellation recovery

Stop/cancel is handled as a runtime lifecycle transition, not just a UI interruption:

1. `stopGeneration()` moves the runtime from `generating` to `cancelling` immediately and logs `inference.cancel.requested`.
2. A real abort confirmation logs `inference.cancelled`, but the interrupted runtime is not treated as safe/ready for a new generation.
3. The app enters `recovering`, records `runtime.recovery.started`, tears down the old worker with bounded termination, creates a new worker/runtime, and reloads the cached model.
4. The app returns to `ready` and logs `runtime.recovery.completed` only after the replacement runtime finishes loading the model.
5. If reload fails, the app records `runtime.recovery.failed` and exposes the existing Reload model action.

Late chunks or confirmations from an abandoned generation must not overwrite newer runtime state.

## Generation timeout and stall watchdog

A generation timeout means absence of runtime progress. It never means "the total generation duration exceeded a timer" while valid output was still arriving — that distinction is the entire reason `packages/ai-runtime/src/generationWatchdog.ts` exists (added in `v0.7.1-alpha`, fixing a release-blocking false timeout — see `docs/DEVLOG.md`'s Sprint 6.21 and `CHANGELOG.md`'s `[0.7.1-alpha]` entry).

`createGenerationWatchdog()` tracks one generation at a time (`packages/ai-runtime/src/runtime.ts` owns a single `currentWatchdog` per runtime instance, matching the existing rule that only one generation can be in flight). It models exactly two "no progress" phases, both measured from the latest real signal rather than from generation start:

- **First-token timeout** (`FIRST_TOKEN_TIMEOUT_MS`, 45s): active only from generation start until the first token/chunk arrives. It allows for model prefill/tokenization time and is permanently cleared — never re-armed — the moment the first chunk arrives.
- **Stall timeout** (`STALL_TIMEOUT_MS`, 45s): active only after the first token/chunk has arrived, and re-armed on every subsequent one. It detects a genuine gap with no new progress; a generation that keeps producing chunks, however slowly, never trips it. Whitespace/punctuation-only chunks still count as progress.

Both phases share one robustness rule: when a scheduled check fires, it recomputes real elapsed time against the latest recorded progress timestamp before doing anything. If the full inactivity window has not actually elapsed — for example because the callback itself fired late due to a busy main thread — it re-arms for the remaining time instead of declaring a false timeout. This makes the watchdog resilient to delayed event loops without relying solely on precise clear-and-recreate timer discipline.

Progress is recorded from the raw worker chunk the instant `generate()`'s `for await` loop receives it — before that chunk is even yielded to the caller, and therefore fully decoupled from `apps/web/app/_lib/streamingBuffer.ts`'s periodic UI flush (see "Streaming render responsiveness" below). A slow React render can never look like a stalled model, because the watchdog never waits on it.

**Total generation duration** remains available as a metric only; it is never itself a stall/timeout condition. A wholly separate, much larger, conservatively-sized `ABSOLUTE_GENERATION_SAFETY_LIMIT_MS` (10 minutes) exists purely as an emergency circuit breaker against a truly pathological runaway generation (e.g. one dodging the stall watchdog forever). It is a flat wall-clock timer, not reset by progress, and deliberately uses its own `generation_exceeded_safety_limit` error code — never `generation_stalled` — so it cannot be confused with a genuine inactivity stall. `apps/web/app/_lib/performanceObservationBuilder.ts` classifies this app-enforced cutoff as neutral `cancelled`, excluding it from router success, failure, and instability scoring.

**Generation-ID isolation.** Every `generate()` call creates its own `GenerationWatchdog` instance (closed over that call's own local progress timestamps) and captures the runtime's `generationEpoch` at start. A watchdog callback that does fire calls the shared `forceRecovery()`, which re-checks the epoch before touching any state. Forced errors are retained by epoch, and every raw stream chunk re-checks that epoch before processing content, so late chunks and terminal confirmations from an abandoned generation cannot affect a newer one. Completion, Stop, degenerate-output recovery, and full runtime disposal all dispose the current watchdog and clear the separate safety-limit timer, so no timer outlives the generation it was armed for.

**Background tabs.** `ai-runtime` stays platform-independent and never reads `document.visibilityState` itself; browser background-tab throttling can otherwise delay both timer firing and worker message delivery in ways indistinguishable from a genuine stall. `InferenceRuntime.setGenerationWatchdogSuspended()` lets the app layer pause inactivity detection entirely while hidden and grant a full fresh detection window on resume (rather than resuming a countdown that may already be most of the way expired), so a backlog of queued progress gets a chance to arrive before a stall could be declared. `AppRuntimeProvider.tsx` is the only caller, via a `visibilitychange` listener — matching the existing rule that FreeAI Open does not treat a hidden tab as a disposal trigger, but does not claim uninterrupted background execution is guaranteed by every browser.

**Outcome.** A genuine watchdog timeout stops/recycles the runtime the same way `cancel_timeout` already does, and records a technical-only failure observation (`generation_stalled`, never response content). If the interrupted generation had already produced visible assistant text, that partial reply is saved with durable `status: "incomplete"` metadata and rendered with an incomplete-response label. The provenance survives IndexedDB reload and local export/import; it is never copied to technical logs or diagnostics. An interruption with no output still discards the empty bubble.

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

### Measured-performance integration

The v0.7 adaptive router consumes `StaticCapabilityProfile`, `LocalBenchmarkResult`, and recent `ModelPerformanceObservation` records directly. This lets real local load failures, stalls, first-token timing, and generation timing adjust decisions without turning a coarse profiler tier into an exact hardware claim. The older optional `DeviceProfilerEnvironment.measuredPerformance` hook remains unwired; no caller invents token-rate data, and `promptTokensPerSecond`/`generationTokensPerSecond` stay absent until the runtime exposes tokenizer-backed counts.

## v0.7.0-alpha — Adaptive Router v1 phases

**Status: Phases 0 through 6 are implemented.** `AppRuntimeProvider` computes a `RouterDecision` before the first model load and applies it — including safe model switching and real observation recording — and `/settings` exposes automatic/manual model selection with a plain-language chat explanation. `/debug` reads that same live decision and loaded model rather than constructing a second preview.

### Contract types and where they live

- `@free-ai-open/types` (`router-signals.ts`): `CapabilityConfidence` (`"low" | "medium" | "high"`, shared by every signal below), `StaticCapabilityProfile` (a device's static, non-benchmarked capability signals — form factor, architecture class, coarse memory/processor counts, WebGPU/WASM availability, and a `gpu` sub-object of coarse classes and bounded feature/limit maps, never a raw adapter string), `LocalBenchmarkResult` (a short local microbenchmark's outcome, with an `expiresAt` so a stale result can be treated as absent), and `ModelPerformanceObservation` (a single observed model load/generation outcome — technical timings and an outcome code, never prompt/response content).
- These four types live in `@free-ai-open/types` rather than in `device-profiler`/`ai-runtime`/a future `local-benchmark` package individually, specifically so every future producer (a capability detector, a benchmark runner, `ai-runtime`) and consumer (`model-router`) can share one contract without any of those packages depending on each other. In particular, `model-router` — meant to stay pure eligibility/scoring/fallback logic — never needs a dependency on the much heavier `ai-runtime` package (which pulls in `@mlc-ai/web-llm`) just to reference `ModelPerformanceObservation`.
- `FormFactor`/`ArchitectureClass` moved from `device-profiler` into `types` as part of this (device-profiler re-exports both, so every existing `import type { FormFactor } from "@free-ai-open/device-profiler"` call site is unaffected) — `StaticCapabilityProfile` reuses the exact same coarse categories as the existing `DeviceProfile` instead of a parallel duplicate definition.
- `@free-ai-open/model-router`: the adaptive implementation is split across normalization, observation aggregation, eligibility, scoring, fallback, and orchestration modules. `routeAdaptiveModel()` is pure and deterministic for a normalized input, registry version, and clock. Its stable reason/warning/rejection codes are translated by the app for normal and debug surfaces.
- `@free-ai-open/model-registry` (`schema-v2.ts`, `registry-v2.ts`, `registry-validation.ts`): `ModelRegistryRecord`, strict runtime validation, and five curated records verified with WebLLM `0.2.84`. Records carry sourced download/runtime estimates, ordered context presets, per-language/task/form-factor/performance-mode scores, capability gates, source/license metadata, known issues, and validated acyclic fallbacks. The package imports WebLLM only in tests to compare exact prebuilt IDs, URLs, libraries, features, and memory metadata; production registry code stays metadata-only. The active adaptive runtime uses `modelRegistryV2`; legacy records remain only for backwards-compatible package tests/helpers.

### Registry and runtime boundary

Model Registry v2 is metadata, not the selector itself. It validates records at module initialization and exposes only fully verified records to the adaptive router. It does not inspect the device, load a model, download an artifact, persist a preference, or call the network. WebLLM remains behind the client-only `ai-runtime`/worker boundary.

The fixed Phase 0 test default changed to the verified `SmolLM2-360M-Instruct-q4f32_1-MLC` compatibility record. As of Phase 4, this record serves as the pre-disclosed fallback: when the router's preferred uncached model needs consent, the runtime attempts the disclosed compact record first so chat can remain usable while the optional upgrade waits. Every subsequent switch resolves through `RouterDecision`; normal runtime errors still surface if even the compatibility model cannot load.

### Persistence boundaries

Three local, schema-versioned preference stores live in `apps/web/app/_lib/`: `capabilityProfileStore.ts`, `benchmarkResultStore.ts`, and `modelObservationStore.ts`. They rebuild exact allowlisted shapes and reject stale, version-mismatched, profile-mismatched, malformed, or unexpected data. Real load and generation observation writers are active, and the capped observation store never accepts arbitrary extra fields.

Matching the mission's recommended boundaries:

- **Session-only, never persisted:** raw GPU adapter strings, exact high-entropy limit maps, active benchmark buffers.
- **Persisted locally:** the coarse `StaticCapabilityProfile`/`LocalBenchmarkResult`/`ModelPerformanceObservation[]` shapes above, plus the existing `gettingStartedPreference` (performance mode) and per-conversation `task`.
- **In diagnostics:** coarse capability categories, benchmark version/status/score, current recommended/loaded model IDs, technical errors/logs/metrics. The `/debug` UI may additionally display the in-memory router reason codes and observation summary; the exported report still contains no conversation content.
- **Never:** prompt, response, conversation, document content, a unique device fingerprint, or the hidden runtime-only language instruction.

### Local benchmark package boundary

`@free-ai-open/local-benchmark` depends only on `@free-ai-open/types`. It owns workload selection, deterministic WebGPU execution, scoring, stability classification, timeout/cancellation handling, and resource cleanup. `apps/web` owns Worker creation, local persistence, lifecycle logs, and UI. The package does not depend on or share a device with `ai-runtime`.

### Dependency graph verified for this phase

No new inter-package dependency edge was introduced: `types` remains a zero-workspace-dependency leaf; `device-profiler`, `model-registry`, and `model-router` already depended on it. `apps/web/app/_lib/packageDependencyBoundaries.test.ts` reads each package's real `package.json` and asserts this holds — including that `model-router` does not depend on `ai-runtime` and vice versa — so a future phase that does add a real edge gets a test failure if it accidentally creates a cycle.

### Phase 4 — Runtime integration

`apps/web/app/_runtime/AppRuntimeProvider.tsx` now owns the full routing lifecycle instead of unconditionally loading the fixed default:

- **Deciding.** `useAdaptiveRuntimeRouting()` builds a `RouterInput` (via `routingOrchestration.ts`'s `buildRouterInputContext()`, which reads the stored capability profile — detecting fresh only if none is valid — the stored benchmark for that profile, stored observations, and real per-model cache status) and calls `routeAdaptiveModel()`. It only recomputes when `apps/web/app/_lib/routingDecisionCache.ts`'s cache key actually changes (task, locale, performance mode, capability/benchmark timestamps, cached-model set, registry version, or the revision of technical observations) — never before every message. Explicit benchmark/profile/history controls invalidate the key, and a completed generation re-evaluates it so repeated failures can affect the next safe model choice. The decision is kept in React state/refs only, never written to `localStorage`.
- **ID spaces.** A `RouterDecision`'s `selectedModelId`/`fallbackModelIds` and every stored `ModelPerformanceObservation.modelId` are registry IDs (matching how `adaptiveRouter.ts` itself matches observations, `item.modelId === model.id`), but `InferenceRuntime.loadModel()`/`RuntimeState.modelId` are WebLLM model IDs. `routingOrchestration.ts`'s `buildLoadCandidatesFromDecision()`/`registryIdForWebllmModelId()` bridge the two spaces at every call site so a load is always requested by WebLLM ID while every recorded observation stays keyed by registry ID.
- **Switching.** `apps/web/app/_lib/modelSwitchPolicy.ts`'s `resolveModelSwitch()` decides what happens when the decision's pick differs from what's loaded: the same model is a no-op; a busy runtime (loading, generating, cancelling, or recovering) defers until the next routing moment; a cached model or the pre-disclosed default (`SmolLM2-360M-Instruct-q4f32_1-MLC`) switches immediately via `performModelSwitch()` (a `model_replacement` runtime-disposal trigger, reusing the existing safe worker-teardown path); anything else shows a `ModelDownloadConsent` prompt before anything downloads. The default's friendly name, approximate size, and local-cache behavior are disclosed in first-run setup. Declined and failed upgrade IDs are retained for the current session so the same prompt/load cannot immediately loop.
- **Loading with fallback.** `attemptModelLoadWithFallback()` walks a bounded candidate list, stopping at the first successful load and recording one technical load observation per attempt. Before loading, `filterDisclosedLoadCandidates()` removes any candidate that is neither cached, explicitly approved, nor first-run pre-disclosed, so fallback cannot become a silent new download.
- **Observations.** Load observations come from `attemptModelLoadWithFallback()`; generation observations are built in `sendMessage()` from locally measured wall-clock timing (`firstTokenTimeMs`, `generationDurationMs`) plus the stream's `stopReason`/error code. Load attempts and generation outcomes are aggregated with separate denominators. User cancellation is excluded from instability rates; repeated stalls, OOM, or device-loss outcomes can reject a model. `promptTokensPerSecond`/`generationTokensPerSecond` are not populated because the runtime does not expose real token counts, and character counts are not substituted.
- **Generation limits.** `RouterDecision.recommendedMaxOutputTokens` threads through to `ai-runtime`'s `generate({ maxOutputTokens })` and can only tighten the existing `GENERATION_SAFETY_LIMITS.maxTokens` cap. `recommendedContextTokens` is passed to WebLLM engine creation as `context_window_size`, capped by the verified maximum context preset of every load candidate.
- **Cache detection.** `ai-runtime` gained `isModelCached()`, a thin wrapper over WebLLM's `hasModelInCache()`. It defaults to `false` (assume a download is needed) on any failure, since that direction only ever triggers an extra consent prompt rather than an undisclosed download.
- **Manual override.** `RouterInput.manualModelId` stays wired through every function used above; Phase 5 supplies it from the app layer — see "Phase 5 — Router UI" below.
- **Diagnostics.** `/debug` reads `AppRuntimeProvider`'s live adaptive decision, selected model, loaded model, runtime status, task, performance mode, and selection mode. Its adaptive panel shows confidence, translated reasons/warnings, fallback chain, rejections, and token budgets, plus a local observation summary. Exported diagnostics use the same live technical IDs/status and still pass through the strict privacy builder.

### Phase 5 — Router UI

The mission's principle: "simple by default, technical on demand." Every technical panel this phase adds is opt-in (`/settings`, `/debug`) or behind a `<details>` disclosure; the normal `/chat` surface gained only a one-line plain-language explanation and richer status wording.

- **Manual override.** A new local preference store, `apps/web/app/_lib/manualModelPreference.ts` (`{mode: "automatic" | "manual", manualModelId}`, schema-versioned, mirrors `gettingStartedPreference.ts`), is loaded into `AppRuntimeProvider` on mount and threaded into every `evaluateRouting()` call as `RouterInput.manualModelId`. `setManualModel()`/`setAutomaticModel()` persist the choice, update state, and immediately trigger a re-route + `applyModelSwitchIfNeeded()` — manual selection goes through the *same* consent flow as automatic routing (`resolveModelSwitch()`); picking a model by hand is not itself consent to download it, and the router still applies its own hard eligibility gates regardless of what was manually requested (warning rather than bypassing them if the pick turns out ineligible).
- **Manual model picker.** `apps/web/app/_components/ManualModelPicker.tsx` (used from `/settings`) lists an "Automatic — recommended" option plus one card per `modelRegistryV2` record: localized friendly name, approximate size, live cache status (`isModelCached()` per model), a technical-details disclosure (exact WebLLM ID, per-language suitability, recommended tasks, device suitability), and an experimental-status note. Cards fail closed while no capability-backed decision exists, then remain disabled — not hidden — for the router's rejected models with the router's own reasons. The selectable area and the details disclosure are siblings, and the disclosure summary has a 44px touch target.
- **Friendly recommendation line.** `apps/web/app/_lib/friendlyRouteExplanation.ts`'s `pickFriendlyRouteExplanation()` reduces a `RouterDecision.reasons[]` list to exactly one plain-language sentence via a fixed priority order. Chat shows it only when the recommended model is the model actually loaded; a pending recommendation is not described as active.
- **Model status labels.** `apps/web/app/_lib/modelStatusLabel.ts` resolves active loading/recovery/error states before pending routing or consent. This prevents a pending upgrade prompt from replacing real "Preparing" progress. `ModelStatusPill` separately names the loaded model and recommendation, so a compact fallback is never labelled as an unloaded recommendation.
- **Download consent refinements.** `PendingModelSwitch` includes mobile form factor for the ≥500MB mobile-data warning. `ModelDownloadConsent` uses localized friendly model names and truthful inline-region semantics rather than claiming modal focus behavior it does not implement.
- **Empty/error states.** `apps/web/app/_lib/chatEmptyState.ts`'s `resolveChatEmptyStateReason()` distinguishes three chat-relevant causes from a `RouterDecision`: every rejected model blocked specifically by `backend_unavailable` → a WebGPU-specific notice instead of the generic "no compatible model" one; a `manual_model_ineligible`/`manual_model_unknown` warning even though a fallback was still selected → a notice that the manual pick was overridden this time; otherwise the existing generic notice. A new `useOnlineStatus()` hook (`apps/web/app/_components/useOnlineStatus.ts`) adds an offline-specific line to the existing model-unavailable error banner when `navigator.onLine` is false.
- **Debug additions.** The Phase 4 adaptive-router panel includes per-model cache status and the provider's real automatic/manual mode. Recommended model, loaded model, runtime status, task, and diagnostic export values all come from the same persistent runtime context.

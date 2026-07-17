# Changelog

All notable changes to FreeAI Open are documented here.

This project follows a format close to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are alpha milestones while the MVP is still under active development.

## [Unreleased]

### Added

- Added a lightweight English/French UI translation system for the web app (home/app shell, chat, conversation history, export/import, debug dashboard, privacy warnings, runtime status labels, common buttons and errors), with a visible language toggle, browser-language detection on first visit, and local persistence. No server or API call is involved; translation dictionaries ship in the client bundle.
- Added light/dark/system theme support with a visible toggle, local persistence, and a blocking inline script that applies the stored theme before hydration to avoid a flash of the wrong theme. Introduced CSS custom-property color tokens (`--color-bg`, `--color-text`, `--color-border`, `--color-bg-elevated`, `--color-danger`, `--color-warning`, `--color-success`, etc.) and replaced hardcoded colors across the app with them.
- Added a mobile layout fix: the `/chat` history sidebar now stacks above the conversation instead of keeping a fixed width that left too little room for the chat on narrow viewports.
- Added chat message layout containment so long unbroken strings, repeated punctuation, and future `pre`/`code` blocks do not expand the page width on desktop or mobile.
- Added alpha generation safety limits for the local WebLLM runtime: bounded `max_tokens`, a maximum generation duration, output character limits, and lightweight degenerate-output detection for repeated symbols/characters or long unbroken sequences.
- Added English/French notices for stopped, timed-out, failed, or unstable generations, including a clear note that partial assistant output was not saved.
- Added accessible labels for the message input, per-conversation rename/delete buttons, the language/theme toggles, and `aria-live`/`role="status"`/`role="alert"` on notice banners.
- Clarified export/import and error wording in both languages (import result summary, invalid file, storage-unavailable, runtime errors).
- Wired local conversation export/import into the `/chat` history sidebar: "Export current", "Export all", and "Import" actions, entirely client-side.
- Export downloads a JSON file via a Blob/object URL; import reads a local file, validates it through `@free-ai-open/conversation-export`, and always creates new conversations (never silently overwrites existing ones).
- Import shows a result summary (imported count, skipped count, readable errors) and a persistent privacy note that exports are unencrypted, contain conversation text, and are never sent anywhere.
- Added `@free-ai-open/conversation-export` for versioned local JSON conversation export/import helpers.
- Added strict import validation for format, version, structure, roles, ISO dates, unexpected fields, conversation/message limits, message length, and JSON size.
- Added import preparation that assigns fresh conversation IDs by default, preserves valid titles/messages, and records local import metadata without overwriting existing conversations.
- Added `CONTRIBUTING.md`, `SECURITY.md`, `docs/PROJECT_OVERVIEW.md`, and a "Privacy/security report" issue template for public repository readiness.
- Expanded the pull request template with changes-made, local storage impact, and diagnostic/logging impact sections, plus an explicit no-content-logged/no-new-network-path/no-cloud-sync checklist.
- Clarified `docs/privacy.md` to distinguish currently implemented user controls (erase conversations, export/import local conversations, erase/export local logs and diagnostic report) from planned ones (telemetry toggle, model cache erase, encrypted export, encrypted Drive sync).
- Added a performance-depends-on-browser/device/model note and links to the new docs to `README.md`.
- Rewrote `README.md` as a project-facing alpha overview with implemented features, explicit non-implemented scope, privacy model, architecture summary, setup commands, and documentation links.
- Added Sprint 5.1 robustness tests for local conversation persistence: real IndexedDB coverage via `fake-indexeddb`, no-IndexedDB memory fallback, active conversation ID pointer storage, local-log rejection of conversation content, and diagnostic-report privacy exclusion for conversation-shaped input.
- Added a release checklist TODO for future browser-level coverage of persisted chat refresh and delete confirmation flows instead of adding a heavy E2E framework prematurely.

### Changed

- Cancelled, stalled, timed-out, failed, or degenerate assistant partial output is no longer saved as a normal completed assistant message. The user prompt remains local conversation content, but the partial assistant bubble is removed and therefore not exported as a completed answer.

### Planned

- Browser-level automated coverage for language/theme persistence, export/import, and Stop/recovery remains limited.
- The model catalog is intentionally small and still uses early compatibility metadata.
- Supabase-backed persistence is not started.
- Google Drive sync is not started.
- The browser runtime still targets a small WebLLM test model before broader model support.
- Export/import has no browser end-to-end coverage yet (verified manually); encrypted export is not implemented.
- End-to-end browser coverage for persisted chat sessions and debug workflows is still limited.

## [0.7.0-alpha] - 2026-07-17 (Phase 0: contracts and architecture)

This phase defines types, package boundaries, local persistence/migration, and documentation for the "Adaptive Model Router v1." It intentionally does not implement the capability profiler, local benchmark, or router itself — see `docs/roadmap.md` for the remaining phases. No existing runtime, routing, or persistence behavior changed.

### Added

- Added the v0.7.0-alpha router-input contract types in `@free-ai-open/types`: `CapabilityConfidence`, `StaticCapabilityProfile` (static device/GPU capability signals), `LocalBenchmarkResult` (short local microbenchmark outcome), and `ModelPerformanceObservation` (a single observed model load/generation outcome). All four are additive and not yet produced by any detector, benchmark, or runtime code.
- Added `RouterInput`/`RouterDecision` in `@free-ai-open/model-router` (`adaptiveRouterContracts.ts`): the future adaptive router's input (task, locale, performance mode, capability, optional benchmark, observation history, cached/manual model IDs) and output (selected/fallback model IDs, confidence, human-readable reasons/warnings, recommended context/output token budgets, a decision version). Coexists with, and does not change, the active v0.6 `ModelRouterInput`/`ModelRouterResult`/`selectRecommendedModel()`.
- Added `ModelRegistryRecord` in `@free-ai-open/model-registry` (`schema-v2.ts`), matching the recommended v2 registry schema: verification status, honest per-field estimates (value/unit/confidence/source, never guessed), context presets, per-language/task/form-factor/performance-mode suitability scores, minimum capability gates, known issues, required license metadata, and cycle-free fallback model IDs. No records exist against this shape yet; the active `ModelRecord`/`sampleModels` are unchanged.
- Added three local, schema-versioned preference stores in `apps/web/app/_lib/` with pure migration functions, following the existing `gettingStartedPreference.ts` convention: `capabilityProfileStore.ts` (`StaticCapabilityProfile`), `benchmarkResultStore.ts` (`LocalBenchmarkResult`, with expiry handling so a stale result is treated as absent), and `modelObservationStore.ts` (`ModelPerformanceObservation[]`, capped at 200 entries, oldest dropped first). None of these are wired into the app yet — no detector, benchmark, or runtime call site writes to them in this phase.
- Added `apps/web/app/_lib/packageDependencyBoundaries.test.ts`, a workspace dependency-graph test (reads real `package.json` files) proving `@free-ai-open/types` stays a zero-dependency leaf and no cycle exists between `model-router`, `ai-runtime`, `model-registry`, and `device-profiler`.

### Changed

- Moved `FormFactor`/`ArchitectureClass` from `@free-ai-open/device-profiler` into `@free-ai-open/types` (device-profiler re-exports both, so every existing `import type { FormFactor } from "@free-ai-open/device-profiler"` call site is unaffected). This lets the new `StaticCapabilityProfile` contract reuse the same coarse categories instead of duplicating them.

### Security and Privacy

- `StaticCapabilityProfile`'s `gpu` fields are coarse classes and bounded feature/limit maps only; the contract has no field for a raw GPU adapter string, and a test documents that intent. Raw adapter strings and exact high-entropy limit maps may be read ephemerally by a future detector but must never be persisted — see "Persistence boundaries" in `docs/architecture.md`.
- `LocalBenchmarkResult` and `ModelPerformanceObservation` never include prompt, response, or conversation content — only technical timings, status/outcome codes, and confidence. Neither type nor its local store calls `fetch`, `sendBeacon`, or any server endpoint.
- No `fetch`, `sendBeacon`, Supabase, Google Drive, cloud sync, new server endpoint, or server-side WebLLM path was added. No existing model-router selection logic, WebLLM runtime behavior, telemetry schema, or diagnostic-report schema changed.

### Tests

- Added contract-shape tests for `StaticCapabilityProfile`, `LocalBenchmarkResult`, `ModelPerformanceObservation`, `RouterInput`/`RouterDecision`, and `ModelRegistryRecord`, each asserting the shape is usable and free of prompt/response/conversation-shaped fields.
- Added migration tests for all three new local stores: valid round-trip, wrong schema version, missing/malformed fields, corrupted JSON, and (for the benchmark store) expiry handling — all matching the existing `gettingStartedPreference.test.ts` pattern.
- Added a test proving `selectRecommendedModel()` (the active v0.6 router) is unchanged and does not accept the new `RouterInput` shape.

## [0.6.6-alpha] - 2026-07-16

### Added

- Added a first-run "Getting Started" flow, shown automatically only when no completed local setup exists: it explains that the model runs on this device, detects the device, recommends a performance mode, lets the user confirm Fast/Balanced/Quality (Quality is only offered when WebGPU is available), and then persists the choice and continues straight to `/chat`. It is not shown again on later visits unless site data is cleared or the user resets it from Settings.
- Added `apps/web/app/_lib/gettingStartedPreference.ts`, a focused local `localStorage` preference store (schema-versioned) recording whether Getting Started is completed, the confirmed performance mode, and optional coarse device-recommendation metadata (tier, WebGPU availability, form factor) used to explain the choice later.
- Added a per-conversation usage picker: selecting "New chat" now opens a small accessible modal (`NewChatTaskDialog`) asking what the conversation is for, backed by the existing `TaskCategory` catalog (General conversation, Writing help, Rewrite & improve, Summarize, Translate, Code helper, Learn something — document analysis is intentionally left out, since the product has no document upload entry point yet). The chosen task is stored on the conversation and never asked again for that conversation; the global performance mode is never re-asked here.
- Added an optional `task` field to `@free-ai-open/conversation-store`'s `Conversation`/`ConversationMetadata` and to `@free-ai-open/conversation-export`'s export/import schema (still format `freeai-open-conversations` version `1`). Older conversations and older export files without a `task` field remain fully valid; the app defaults a missing/invalid task to general chat behavior rather than losing the conversation.
- Redesigned `/settings` into a real settings page: change the performance mode (with plain-language explanation and an explicit "Save" step, so a change is never applied silently and can't interrupt a reply that's currently generating), change language and theme, re-check this device, and reset Getting Started — with device profile, exact mode value, and the local model ID available behind an "Advanced technical details" disclosure.
- Added a dedicated desktop chat workspace layout (`apps/web/app/chat/layout.tsx` plus new `.chat-shell`/`.chat-main__*` rules in `globals.css`, scoped to `/chat` only): on desktop, the workspace fills the viewport height, the conversation sidebar and the message transcript scroll independently, and the composer stays anchored at the bottom, so switching conversations or scrolling history never moves the page back to the top. Mobile keeps the existing off-canvas drawer and normal page scrolling unchanged.
- Added a stable application-level client runtime provider mounted from the root layout. The WebLLM worker/runtime is now owned above route boundaries instead of by `/chat`, so an already-loaded local model is retained while navigating between Chat, Settings, and Debug.
- Added a persistent generation coordinator in the same provider. Active generation state now carries a `generationId`, conversation ID, and assistant message ID so streamed chunks remain associated with the correct conversation while `/chat` is unmounted, and stale chunks cannot overwrite newer conversation state.
- Added a small global runtime status strip for useful cross-route states: model loading, generation outside Chat, recovery, and errors needing attention. When a response is being generated away from `/chat`, it offers a translated "Return to conversation" action.
- Added explicit runtime lifecycle and settings policies covering root teardown, route-view unmount, visibility changes, explicit reload, recovery, and performance-mode changes.

### Fixed

- Fixed a light-mode contrast bug where the desktop navigation rail's selected language/theme control could show white text on a very light teal background (unreadable for labels like "FR" and "Système"). The rail now forces its semantic color tokens to dark-surface values (the same technique already used by `.fo-ink-surface`), so the selected state always resolves to accessible text regardless of the site's light/dark theme, and stays visible through background, border, and bold text rather than color alone.
- Fixed internal navigation cancelling the local runtime: leaving `/chat` no longer calls runtime disposal, no longer terminates/unloads the worker/model, and no longer cancels an active generation solely because the route component unmounted.
- Fixed Settings performance changes so they go through the runtime provider. A mode change is blocked while a generation, cancellation, or recovery is active, and this alpha persists the new preference without replacing the runtime because all modes still use the same placeholder model.
- Fixed the previous root cause where `ChatPage` owned `runtimeRef`, `workerRef`, generation refs, and an effect cleanup that disposed the runtime whenever the chat route unmounted.
- Fixed the desktop chat workspace so the app-level runtime status strip no longer makes `/chat` taller than the viewport; the chat shell now fills the remaining app-main height and keeps transcript/sidebar scrolling internal.
- Fixed transcript auto-follow logic to read the independently scrolling transcript container on desktop, while keeping page-scroll fallback for mobile.

### Changed

- The home page now gates on Getting Started: if it isn't completed, the user is sent straight to `/onboarding` instead of being offered a "skip setup" shortcut. Once complete, home shows a single "Open chat" action plus the existing device-capability summary and privacy notice.
- `/onboarding` no longer includes a separate task-selection step (`/onboarding/task` is removed); it now only detects the device and confirms a performance mode, then hands off to per-conversation task selection in `/chat`.
- `/chat` primarily reads performance mode from the Getting-Started preference store and task from the active conversation's stored metadata (defaulting missing/invalid values to general chat). The provider keeps a legacy query-parameter bridge for older `/chat?task=...&mode=...` links, but new app flows no longer depend on it. The model-router recommendation panel updates automatically when the active conversation's task or the performance mode changes; the WebLLM worker/runtime lifecycle is unaffected by either, since this alpha always loads the same placeholder model regardless of the routing recommendation.

### Security and Privacy

- The new Getting Started preference store is a single `localStorage` key holding only a completion flag, the chosen performance mode, and coarse, already-reviewed device-profile fields (tier, WebGPU availability, form factor) — never raw sensor values, never sent to a server.
- The per-conversation `task` field is a short catalog label (e.g. "coding", "writing"), never prompt or response content; it is included in local exports the same way the title already is, and is rejected by import validation if it isn't a bounded string.
- The provider may hold technical runtime state, current conversation/generation IDs, and in-memory streamed UI state, but it does not write prompts, responses, message content, or documents to technical logs, diagnostic reports, telemetry, server storage, Supabase, or any network path.
- Browser tab visibility is not treated as a disposal trigger. Background tabs may still be throttled by the browser or mobile OS, but FreeAI Open does not intentionally cancel or unload the local model solely because the tab becomes hidden.
- No `fetch`, `sendBeacon`, Supabase, Google Drive, cloud sync, new server endpoint, server-side WebLLM path, or full v0.7 model-router change was added.

### Tests

- Added tests for the Getting Started preference store (completion, mode persistence, device snapshot, schema-version guard, reset), the New Chat task catalog (excludes document analysis, mirrors the shared `TaskCategory` list), conversation-task migration defaults, conversation-store/export round-tripping and backward compatibility for the new `task` field, the rail's forced-dark contrast tokens, and the desktop chat workspace's CSS layout structure (fixed height, independent scroll regions, anchored composer, route-scoped footer hiding).
- Added tests for runtime lifecycle policy (route-view unmount and hidden tab are non-disposal triggers; root teardown/reload/recovery/replacement are disposal triggers).
- Added tests for persistent runtime lifecycle ownership: one runtime instance is reused while the app provider stays mounted, route unmount does not dispose or terminate the worker, explicit reload terminates the old worker safely, and root teardown cleans up.
- Added tests for generation identity guards and stale chunk rejection.
- Added tests for safe performance-mode change decisions, including active-generation blocking and the current no-replacement placeholder-model behavior.
## [0.6.5-alpha] - 2026-07-16

### Added

- Added the first FreeAI Open brand/design-system foundation based on the local brand guide: `--fo-*` color, typography, radius, spacing, focus, motion, surface, and semantic tokens in `apps/web/app/globals.css`.
- Added production web logo assets under `apps/web/public/brand/`: `freeai-open-app-icon.png`, `favicon.png`, `apple-touch-icon.png`, `pwa-icon-192.png`, and `pwa-icon-512.png`, generated from the local square app-icon source.
- Added `BrandMark`, a compact navigation brand component that uses the square symbol asset and renders "FreeAI Open" as real HTML text instead of embedding the large horizontal raster logo.
- Added public brand documentation in `docs/brand.md`, covering logo usage, production asset locations, colors, typography, accent discipline, accessibility, and the remaining need for a true vector logo source.
- Completed the product-wide UX/visual redesign on top of the brand foundation: a responsive app shell (`apps/web/app/_components/Header.tsx`), a shared `DeviceCapabilitySummary` component, and a small hand-rolled line-icon set (`apps/web/app/_components/icons.tsx`, no new dependency).
- Added a compact, always-Ink desktop navigation rail (brand icon, Home/Chat/Settings/Debug links, language/theme toggles) and a compact fixed, safe-area-aware mobile top bar with a small dropdown menu for the same links/toggles, both rendered from the same markup with the visibility split handled entirely by the existing 720px CSS breakpoint.
- Added a plain-language device capability summary ("Limited compatibility" / "Suitable for lightweight models" / "Recommended experience" / "High-performance device") shown by default on the home page and the onboarding device-check step, with the raw device tier, backend, memory, and storage figures moved behind an "Advanced technical details" disclosure.
- Added a "Use the recommended setup" primary action on the home page that waits for the local device profile and then links directly to a working `/chat?task=chat&mode=<recommended>` session using the same recommendation source as onboarding; while profiling is pending, the CTA shows a detection state instead of falsely claiming `balanced` is recommended.
- Highlighted the device-recommended performance mode on the onboarding mode-selection step with a "Recommended for this device" badge.
- Renamed the "Performance" mode's display label to "Quality" (English) / "Qualité" (French) for the normal interface; the underlying `PerformanceMode` value and all routing logic are unchanged.
- Added plain-language runtime status wording ("Preparing the local model", "Ready on this device", "Writing a response", "Preparing the model again", …) for the normal chat interface, with the existing raw-ish `runtimeStatus.*` labels reserved for technical/debug use.
- Added a "Technical details" disclosure under the local-model-unavailable error, showing the raw runtime error code without changing the plain-language error message shown by default.
- Converted the chat composer from a single-line input to a multiline `<textarea>` (Enter to send, Shift+Enter for a new line, `enterKeyHint="send"` for mobile keyboards), with a visible composer hint and safe-area bottom padding on mobile.
- Added a screen-reader-only role label ("You" / "Local assistant") on each chat message bubble so user/assistant distinction does not rely on alignment or color alone for assistive technology.
- Made the `/debug` dashboard predominantly Ink regardless of the selected theme, and applied the brand guide's monospace discipline throughout it: technical values (backend, device tier, form factor, model source/status/size/license, timings, tokens/sec, log events/error codes, `contentLogged`) render in monospace; explanatory text stays in the normal sans-serif font. The debug dashboard now also surfaces `formFactor` and the raw runtime status code (previously only shown as a translated word).
- Extended `docs/brand.md` with the source brand guide's full color-usage rule (80% neutral / 15% secondary surface / 5% teal maximum), the complete typography scale, per-component treatment rules, imagery guidance (what to use, what to avoid), and editorial tone-of-voice examples.

### Changed

- Consolidated the visual foundation around semantic brand tokens while preserving the existing `--color-*` aliases so current screens continue to work during the gradual UI migration.
- Updated the header, footer, language/theme toggles, status badges, privacy notice, debug sections/actions, and primary onboarding/home CTAs to use the shared token/classes foundation.
- Updated Next.js metadata to reference the new favicon and Apple touch icon assets.
- Rewrote every remaining app surface (home, all four onboarding steps, chat, conversation history/import-export, debug, settings) to use the shared `--fo-*` tokens and `.fo-*`/`.app-shell__*` classes instead of local inline colors; no `--color-*` compatibility alias is referenced directly from component code anymore, though the aliases themselves remain defined for any future/external use.
- Restyled the conversation history list: the active conversation now has an accent-soft background plus a left accent stripe (not color alone — the row is also bold and carries `aria-current`), and rename/delete actions are minimal underlined text controls instead of bordered buttons, reducing visual noise around the conversation list.
- Restyled the shared export/import controls with the button/card token system; behavior, wiring, and the existing privacy note (readable JSON content, not encrypted, no cloud sync) are unchanged.
- Tightened light-mode semantic text colors: muted text now uses `#68707A`, and small teal text uses the accessible `--fo-accent-text` token (`#007E68`) while the brighter teal brand tokens remain available for visual accents, borders, focus, and active decoration.
- Raised mobile/coarse-pointer touch targets for language/theme choices, the mobile history trigger, drawer close control, conversation rename/delete/confirm/cancel actions, and import/export actions to the intended 44px minimum while keeping compact desktop styling.

### Tests

- Added recommendation tests proving the home recommended CTA resolves tier 0/1 devices to `fast`, ordinary supported devices to `balanced`, strong devices to `performance`, and pending profiling to no hardcoded `balanced` link, while sharing the same recommendation source as onboarding.
- Added WCAG contrast tests that calculate ratios for core semantic text pairs, plus coverage for mobile touch-target CSS, accessible icon/action labels, delete-confirm wiring, and theme preference persistence.

### Security and Privacy

- No model-routing package behavior, WebLLM runtime behavior, telemetry, diagnostics, local logs, server endpoint, `fetch`, `sendBeacon`, Supabase, Google Drive, or cloud-sync path changed.
- Local brand-source files under `.local/brand-source/` remain local-only and are not part of the public repository.
- The new `DeviceCapabilitySummary` component and the debug dashboard's `formFactor` field only ever display the same coarse `DeviceProfile` fields already covered by prior privacy review; no new device signal was added and nothing new is transmitted.

## [0.6.4-alpha] - 2026-07-16

### Fixed

- Fixed mobile conversation navigation: the "Open conversation history" control is now a persistent `position: fixed` button pinned to the top-right corner of the viewport on mobile, so it stays reachable while scrolling through a long conversation instead of scrolling away with the page. The button now toggles the drawer (its label and `aria-expanded` reflect open/closed state) and is hidden while the drawer itself is open, since the drawer already offers its own close button, backdrop, and Escape handling.
- Fixed mobile drawer focus handling: opening the drawer now moves focus to the visible close button, closing it restores focus to the trigger when available, and the chat background is isolated with `inert` where supported plus a focus redirection guard so keyboard focus cannot move behind the overlay.
- Fixed device tier overestimation on mobile/tablet hardware: `getDeviceTier` no longer derives the tier primarily from `navigator.deviceMemory`. A high-RAM phone (e.g. a 12 GB Redmi Note 13 Pro 5G) is no longer automatically classified the same as a desktop PC (tier 3/`webgpu_high`); iPadOS Safari desktop-style user agents (`Macintosh` plus multitouch) are treated conservatively as tablets before the generic macOS desktop fallback; high RAM alone is not enough to promote these devices to tier 3.

### Added

- Added safe-area-inset awareness for the fixed mobile trigger and the drawer panel (`env(safe-area-inset-*)`, with `viewport-fit: cover` enabled in `apps/web/app/layout.tsx`) so neither is drawn under a device notch, status bar, or home indicator where supported.
- Added a richer, still-coarse device capability profile to `@free-ai-open/device-profiler`: `formFactor` (`mobile`/`tablet`/`desktop`/`unknown`), `architectureClass` (`arm`/`x86`/`unknown`, from the Client Hints high-entropy API when available), `memoryClass`, and `cpuConcurrencyClass` (both coarse `low`/`medium`/`high`/`unknown` buckets, never raw numbers).
- Added a `measuredPerformance` input (`modelLoadTimeMs`, `firstTokenTimeMs`, `tokensPerSecond`, `recentFailureCount`) that `getDeviceTier`/`buildDeviceProfile` can optionally consume: strong measured tokens/sec can promote a device above its form-factor-based tier cap, and repeated recent failures can demote it by one tier. No caller populates this yet with real data — see "Changed" below.
- Replaced the previous RAM/storage tier thresholds with a small, documented scoring model in `@free-ai-open/device-profiler`'s new `scoring.ts`: bounded points for coarse memory/CPU/backend signals, a form-factor tier cap for mobile/tablet/unknown devices, and optional measured-performance promotion/demotion — see `docs/architecture.md`.

### Changed

- `DeviceProfile` now always includes `formFactor`, `architectureClass`, `memoryClass`, and `cpuConcurrencyClass`; `model-router`'s legacy `routeModel()` input path (which only carries a bare tier number, not a full profile) reports these as `"unknown"` rather than guessing.
- Model routing itself is unchanged: `model-router` continues to consume `DeviceProfile.deviceTier` as a plain `0–4` number and does not need to know how the tier was computed.

### Tests

- Added device-profiler tests proving: WebGPU absence still forces tier 0 regardless of memory; a 12 GB mobile phone never reaches tier 3 from coarse signals alone; iPadOS Safari desktop-style user agents with multitouch classify as tablets; normal macOS desktops with zero/single-touch reports remain desktop; contradictory iPad-style signals fall back to `"unknown"`; high-RAM tablets do not reach tier 3 from memory alone; a 12 GB desktop reaches a different (higher) tier than an identical-memory mobile device; a low-memory desktop stays conservative; a mobile device with WebGPU but no measurements stays conservative even at high coarse scores; strong measured tokens/sec promotes a mobile device; weak measured performance does not promote; repeated recent failures demote a profile by one tier without going below tier 1; and unavailable browser capability APIs (Client Hints, `hardwareConcurrency`, UA hints) fall back safely to `"unknown"` instead of throwing.
- Added a test asserting `DeviceProfile` only ever exposes the coarse category values (never a raw `hardwareConcurrency`, `userAgent`, or `maxTouchPoints` field), so it cannot act as a unique hardware fingerprint.
- Updated `model-router` and `diagnostic-report` test fixtures for the new required `DeviceProfile` fields; router and diagnostic-report behavior itself is unchanged and their existing assertions still pass.
- Added a mobile-history-drawer reducer test for the new toggle action.
- Added mobile drawer accessibility helper tests for focus transfer to the close button, fallback focus to the panel, focus restoration to the trigger, `inert`/`aria-hidden` background isolation cleanup, and focus redirection when focus attempts to leave the drawer.

### Security and Privacy

- All new device capability fields are coarse, bucketed categories (4 or fewer possible values each), never raw sensor values, a raw user agent string, or a combined hardware fingerprint. The iPadOS desktop-style heuristic uses only local `userAgent`/`maxTouchPoints` signals to choose a coarse `tablet` bucket and never stores or transmits those raw values. No new remote transmission, `fetch`, `sendBeacon`, Supabase, Google Drive, or server endpoint was added; device profiling remains entirely local and synchronous with the existing `/onboarding/device` and `/debug` display paths.

## [0.6.3-alpha] - 2026-07-16

### Added

- Added an accessible mobile conversation history drawer: below a 720px viewport width, the `/chat` history panel (new chat, conversation list, rename/delete, export/import) now opens as an off-canvas overlay from a menu button in the chat header, instead of stacking above the conversation.
- The mobile drawer closes automatically when a conversation is selected or a new chat is started, and can also be closed via a close button, a backdrop click, or Escape; focus returns to the menu button after closing.
- The drawer blocks background page scrolling while open, does not trap keyboard focus, marks its off-screen content `inert` when closed on mobile so it isn't keyboard-reachable, and respects `prefers-reduced-motion`.
- Added `history.title` ("Conversations"), `history.openHistory` ("Open conversation history"), `history.closeHistory` ("Close conversation history"), `history.importConversations` ("Import conversations"), and `history.exportConversations` ("Export conversations") translation keys in English and French.
- Added buffered chat transcript rendering for streamed WebLLM output, with a named `STREAM_RENDER_INTERVAL_MS` interval, so tiny runtime chunks no longer force a React render for every token.
- Added near-bottom chat autoscroll that uses `requestAnimationFrame`, follows new output only while the user is already near the bottom, and exposes a translated "Scroll to latest" action when the user has scrolled up.

### Changed

- Replaced the mobile `.chat-sidebar` stacking behavior (added in Sprint 6.2) with the drawer/overlay pattern described above. The desktop sidebar's layout, proportions, and behavior (selection, rename, delete, new chat, import, export) are unchanged, since the drawer reuses the existing `ChatHistorySidebar` component without modification.
- The shared export/import controls now group the export buttons under a labelled ARIA group and use clearer accessible names ("Import conversations") for the hidden file input.
- Reduced streaming-render pressure by batching visible assistant text updates while preserving every generated character for local completion handling and persistence decisions.
- Memoized the history drawer/sidebar/export controls and individual message bubbles so unchanged UI regions do not rerender on each streamed text flush.

### Security and Privacy

- The mobile drawer only re-presents existing local-only conversation history and export/import actions through the same unmodified handlers; no new server endpoint, `fetch`, `sendBeacon`, Supabase, Google Drive, or cloud sync path was added, and no new local storage keys or technical log events were introduced.
- Streaming buffering is UI-only and in-memory. It does not change the WebLLM runtime stream, does not add logs or telemetry, and does not write generated content to local technical logs or diagnostic reports.

## [0.6.2-alpha] - 2026-07-15

### Fixed

- Completed English/French UI coverage across the public app surfaces: home, onboarding, settings, app shell, chat, conversation history, export/import controls, debug dashboard, runtime status badges, model loading/recovery states, privacy notices, errors, confirmation messages, theme controls, language controls, and accessibility labels.
- Replaced hardcoded onboarding, settings, task/mode catalog, model-router explanation, and runtime recovery strings with typed translation keys.
- Added tests that compare English and French catalog keys, cover representative strings from every public route/component area, verify locale preference persistence, and verify safe English fallback behavior for unexpected missing keys.
- Fixed Stop recovery so a confirmed cancellation no longer marks the interrupted runtime as ready for the next generation. The app now treats the interrupted worker as unsafe, recycles it, reloads the cached model, and returns to `ready` only after the replacement runtime loads.
- Added the `recovering` runtime status to runtime types, local logs, diagnostic report validation, debug dashboard display, runtime status labels, and tests.

### Changed

- Before each WebLLM generation, the app now passes a hidden runtime-only language instruction based on the selected UI locale.
  - French: "Réponds en français par défaut. Utilise une autre langue uniquement si l’utilisateur le demande explicitement."
  - English: "Reply in English by default. Use another language only when the user explicitly requests it."
- The hidden language instruction is best effort. Actual response language still depends on the selected local model and the user's explicit request.
- The hidden instruction is not persisted in conversation history, not shown in the UI, not exported with conversations, not included in diagnostic reports, and not written to local technical logs.
- Import validation errors shown in the chat sidebar now use localized UI messages instead of package-internal English validation text.

### Security and Privacy

- Added technical-only runtime recovery log events: `runtime.recovery.started`, `runtime.recovery.completed`, and `runtime.recovery.failed`.
- Recovery logs contain only event names, severity, runtime status, and technical error codes.
- Added tests proving the hidden language instruction is not exported, logged, or included in diagnostics.

## [0.5.0-alpha] - 2026-07-05

### Added

- Added `@free-ai-open/conversation-store` for local-only browser conversation persistence.
- Added IndexedDB-backed conversation storage with an in-memory fallback when IndexedDB is unavailable.
- Added strict TypeScript types for conversations, messages, metadata, IDs, and roles.
- Added local limits for maximum conversations, messages per conversation, message size, and title size.
- Added unit tests for create/list/get, adding messages, renaming, deleting, clearing, memory fallback, storage failures, and network isolation.
- Wired the local conversation store into the `/chat` UI: a history sidebar lets users create, resume, rename, and delete conversations.
- Sending a message now lazily creates a local conversation, titled from the first message, instead of sending anything to a server.
- Assistant replies are saved locally once generation finishes or is cancelled, including partial replies from a stopped generation.
- The active conversation resumes automatically after a page refresh, using a local, non-sensitive ID pointer, with no cloud or cross-device sync involved.
- Added "Stored locally" / "This conversation stays on your device" messaging and a note that clearing site data deletes local history.
- Added non-blocking storage-error notices in the chat UI so a local persistence failure never blocks chatting.

### Security and Privacy

- Conversation content remains local browser data.
- Conversation storage does not use `fetch`, `sendBeacon`, Supabase, Google Drive, telemetry, local logs, or server endpoints.
- Diagnostic reports continue to reject conversation content fields.
- The chat UI never passes conversation content to `logEvent`, local technical logs, or diagnostic reports.
- The `conversationId` used for runtime and console correlation is a non-content technical identifier, not user content; it is not sent to the server, stored in local technical logs, or included in diagnostic reports.

### Known Limits

- Conversations are stored per-browser only; there is no cloud sync or cross-device persistence.
- No import/export UX has been added yet (planned for Sprint 6, see `docs/roadmap.md`).
- Browser end-to-end tests for persisted chat sessions are still pending.
- The local model only sees the current prompt; persisted history is not replayed back into the model as context yet.
- Switching or starting a new conversation is disabled while a reply is generating or cancelling, to avoid mixing streamed tokens across conversations.

## [0.4.1-alpha] - 2026-07-04

### Fixed

- Hardened Stop generation recovery so the runtime moves through a `cancelling` state instead of remaining stuck in `generating`.
- Added cancellation and stall timeouts for wedged local generation.
- Prevented late cancel confirmations or stalled-generation callbacks from overwriting newer runtime state.
- Added a Reload model recovery path that can replace a stuck runtime without a browser refresh.
- Ensured worker teardown terminates the worker even if `runtime.dispose()` or WebLLM `engine.unload()` remains pending.
- Preserved `runtimeStatus: "cancelling"` in diagnostic reports and local technical logs.

### Security and Privacy

- Kept runtime stop/cancel logs technical only.
- Added tests proving prompt and response content are not persisted in runtime logs.

### Tests

- Added runtime tests for Stop, `cancelling`, `inference.cancelled`, `cancel_timeout`, `generation_stalled`, late confirmations, and privacy-safe logs.
- Added worker teardown tests for pending, resolving, and rejecting dispose calls.
- Added diagnostic report tests for `runtimeStatus: "cancelling"`.

## [0.4.0-alpha] - 2026-07-04

### Added

- Added local technical logs stored in the browser through IndexedDB with safe fallbacks.
- Added privacy-safe diagnostic report generation and JSON/clipboard export helpers.
- Added the `/debug` dashboard for local system status, model status, performance metrics, recent technical logs, and diagnostic export.
- Added top-level diagnostic report metrics derived from local logs:
  - `modelLoadTimeMs`
  - `firstTokenTimeMs`
  - `tokensPerSecond`
  - `generationDurationMs`
- Added runtime privacy safety tests for future WebLLM integration work.

### Security and Privacy

- Local logs pass through privacy redaction and strict allowlists before storage.
- Diagnostic reports are reduced to technical fields and force `contentLogged: false`.
- Diagnostic export does not include prompts, responses, documents, conversations, messages, user text, input text, output text, or chat history.
- No server upload path was added for local logs or diagnostic reports.

### Fixed

- Hardened WebLLM runtime error handling.
- Normalized runtime model IDs and error codes before writing local logs.

## Early alpha history

### Sprint 1

- Created the initial app shell and repository structure.
- Added the typed model registry.
- Added privacy redaction utilities.
- Added strict telemetry schemas and validation tests.

### Sprint 2

- Added device profiling.
- Added adaptive model routing based on task category, performance mode, and device capability.
- Added onboarding flows for device, task, and performance mode selection.

### Sprint 3

- Added the initial WebLLM browser runtime integration through a Web Worker.
- Added a simple local chat flow using the browser runtime.
- Added runtime error classification and privacy safety tests.

[Unreleased]: https://github.com/maximecapard/Free-ai-open/compare/v0.7.0-alpha...HEAD
[0.7.0-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.6-alpha...v0.7.0-alpha
[0.6.6-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.5-alpha...v0.6.6-alpha
[0.6.5-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.4-alpha...v0.6.5-alpha
[0.6.4-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.3-alpha...v0.6.4-alpha
[0.6.3-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.2-alpha...v0.6.3-alpha
[0.6.2-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.1-alpha...v0.6.2-alpha
[0.5.0-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.4.1-alpha...v0.5.0-alpha
[0.4.1-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.4.0-alpha...v0.4.1-alpha
[0.4.0-alpha]: https://github.com/maximecapard/Free-ai-open/releases/tag/v0.4.0-alpha

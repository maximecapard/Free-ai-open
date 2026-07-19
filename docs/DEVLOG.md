# Development Log

This log summarizes the implementation history of FreeAI Open. It is intentionally factual: it records what has been built, what privacy boundaries were protected, and what remains incomplete.

## Current status

FreeAI Open is an alpha-stage, local-first browser AI assistant. The current codebase includes:

- a Next.js app shell and basic chat UI;
- local WebLLM runtime integration through a Web Worker;
- device profiling, Capability Profiler v2 static capability detection, and task-based model routing;
- privacy redaction, structured technical logging, and telemetry schema validation;
- local technical logs in IndexedDB;
- a debug dashboard and privacy-safe diagnostic report export;
- a local-only conversation-store package wired into the `/chat` UI through a history sidebar for create, resume, rename, and delete;
- local conversation export/import, wired into the `/chat` history sidebar (export current, export all, import with a result summary);
- English/French UI translation with browser-language detection and a visible toggle, including onboarding/settings/debug/chat surfaces, plus a runtime-only language instruction for model replies;
- light/dark/system theme support with a visible toggle, persisted locally.

The product is not yet a complete MVP. Broad model support, encrypted sync, production-ready telemetry persistence, and browser end-to-end coverage remain future work.

## Sprint 1 - App shell, model registry, privacy redactor, telemetry schema

### Built

- Initial Next.js app shell and project structure.
- Typed model registry package with model metadata validation.
- Privacy redactor package for removing forbidden content-bearing fields.
- Strict telemetry schema package with technical field allowlists.
- Initial app UI surfaces and supporting documentation.

### Privacy and architecture notes

- Prompts, responses, documents, messages, and chat history are treated as forbidden telemetry content.
- Telemetry accepts technical data only, such as task category, model ID, backend, error code, and coarse performance metrics.
- Model metadata must include source, license, backend, estimated size, status, and compatibility metadata.

### Remaining limits after Sprint 1

- No browser runtime yet.
- No device profiling or routing integration in the user flow.
- No local logs or diagnostic report export.

## Sprint 2 - Device profiler, model router, onboarding

### Built

- Device profiler package with safe browser-only WebGPU detection and fallback behavior.
- Device tier model:
  - Tier 0: `cpu_only`
  - Tier 1: `webgpu_low`
  - Tier 2: `webgpu_medium`
  - Tier 3: `webgpu_high`
  - Tier 4: `desktop_power`
- Model router package using the model registry and `TaskCategory`.
- Onboarding flow for task selection, device checks, and performance mode.
- UI integration for recommended model and rejected-model explanations.

### Privacy and architecture notes

- Device profiling stays client-side and falls back when browser APIs are unavailable.
- Routing works from technical device and model metadata, not user prompt content.

### Remaining limits after Sprint 2

- Recommendations were not yet tied to a complete runtime experience.
- Browser-specific behavior still needed runtime integration testing.

## Sprint 3 - WebLLM runtime

### Built

- Initial WebLLM runtime integration through a browser Web Worker.
- Runtime state management for model loading, ready, generating, and error states.
- Simple chat page that sends prompts only to the local browser runtime.
- Runtime error classification for WebGPU availability, unsupported models, memory issues, and unknown failures.
- Structured runtime logs with prompt length and response length only.

### Privacy and architecture notes

- WebLLM imports stay inside the client runtime and worker boundary.
- Prompt text and generated response text are not sent to telemetry.
- Runtime safety tests verify logs do not contain prompt or response content.

### Remaining limits after Sprint 3

- Stop generation could leave the runtime stuck in `generating` in some WebLLM edge cases.
- Runtime recovery still required stronger worker teardown behavior.
- The model catalog remained intentionally small.
- Full persisted conversations were still missing.

## Sprint 4 - Local logs, debug dashboard, diagnostic report

### Built

- `@free-ai-open/local-logs` package for local technical logs in IndexedDB.
- Privacy redaction and strict allowlists before local log storage.
- Safe local-log behavior when IndexedDB is unavailable or storage operations fail.
- `@free-ai-open/diagnostic-report` package for privacy-safe diagnostic report generation.
- JSON and clipboard export helpers for diagnostic reports.
- `/debug` dashboard showing:
  - WebGPU and backend status;
  - device tier;
  - performance mode preview;
  - runtime status;
  - recommended and loaded model details;
  - local technical logs;
  - performance metrics;
  - `contentLogged: false`.

### Privacy and architecture notes

- Local logs and diagnostic reports are local-only.
- Diagnostic reports are passed through redaction and rebuilt from technical allowlists.
- Exported reports force `contentLogged: false`.
- No server endpoint, Supabase integration, Google Drive integration, or fetch/sendBeacon path was added for logs or reports.

### Remaining limits after Sprint 4

- The debug dashboard is intentionally simple.
- No full browser end-to-end tests cover copy/download/clear logs.
- Local logs are technical only and are not a conversation persistence layer.

## Sprint 4.1 - Stop generation runtime recovery

### Built

- Added a `cancelling` runtime state.
- `stopGeneration()` now moves from `generating` to `cancelling` immediately.
- Added `inference.cancel.requested` logs for Stop clicks.
- `inference.cancelled` is logged only after the runtime receives a real cancel confirmation.
- New messages are blocked while cancelling and allowed again after the runtime returns to `ready`.
- Added `cancel_timeout` recovery when cancellation is not confirmed.
- Added `generation_stalled` recovery when generation never produces a token.
- Added `generationEpoch` protection so late confirmations cannot overwrite newer state.
- Added worker teardown that terminates the worker even if `runtime.dispose()` or WebLLM `engine.unload()` remains pending.
- Added Reload model recovery for stuck runtime states.
- Updated diagnostic reports and local logs to preserve `runtimeStatus: "cancelling"`.

### Privacy and architecture notes

- Stop, cancel timeout, and stall recovery logs contain technical event names, model IDs, statuses, and error codes only.
- Prompt, response, document, conversation, and message content remain excluded from logs and diagnostic exports.
- Runtime AI code remains browser-side.

### Remaining limits after Sprint 4.1

- Worker teardown is covered by unit tests, but not yet by a browser-level recovery test.
- Reload model is implemented in the UI, but a full UI interaction test is still useful.
- Runtime behavior still depends on WebLLM/browser behavior for real-world cancel confirmation timing.

## Sprint 5 - Local conversation history

### Built

- Added `@free-ai-open/conversation-store`: local IndexedDB persistence with an in-memory fallback, schema versioning (`createdAt`, `updatedAt`), and limits for total conversations, messages per conversation, message size, and title size.
- Added create/list/get/add message/rename/delete/clear/recent APIs on the store.
- Added a chat history sidebar (`ChatHistorySidebar`) to `/chat`: new chat, select-to-resume, inline rename, and delete with a confirm step.
- Sending a message lazily creates a conversation (title derived from the first message) and persists the user message before generation starts.
- The assistant reply is persisted once generation completes or is cancelled, including partial text from a stopped generation.
- The last-viewed conversation resumes automatically after a refresh, tracked by a small local ID pointer (not conversation content) with a most-recent fallback.
- Local storage failures (create/add/rename/delete) surface a small dismissable notice without blocking chatting; the chat still works in-memory if persistence fails.

### Privacy notes

- Conversation content stays in the browser and is only ever passed to `@free-ai-open/conversation-store` calls, never to `logEvent`, local technical logs, or diagnostic reports.
- The package does not call network APIs, server endpoints, Supabase, Google Drive, telemetry, or local logs.
- The `conversationId` passed to `ai-runtime`'s `generate()` is a non-content technical identifier: it may appear in structured console logs for local debugging, but it is not user content, it is not stored in local technical logs, and it is not included in diagnostic reports.
- Diagnostic report tests ensure conversation content fields are not exported.

### Known limitations after Sprint 5

- New chat and conversation switching are disabled while a reply is generating or cancelling, to avoid mixing streamed tokens across conversations.
- The local model is single-turn: persisted conversation history is not replayed back into the model as context.
- There is no encrypted sync, import/export UI, or multi-device persistence.
- IndexedDB schema migration is intentionally simple and currently starts at schema version 1.
- No dedicated browser end-to-end tests for persisted chat sessions yet; this sprint's UI flow was verified manually.

### Planned work (not implemented yet)

- Sprint 6: local export/import of conversations (see `docs/roadmap.md`).
- Later: client-side encrypted export, optional Google Drive sync, improved model selection, and a benchmarks page. None of these exist in the code yet.

## Sprint 5.1 - v0.5.0-alpha polish and robustness tests

### Built

- Corrected the `conversationId` description in this log to state precisely what it is (a non-content technical identifier), where it can appear (structured console logs), and where it must not appear (local technical logs, diagnostic reports).
- Rewrote `README.md` as a public alpha overview focused on current features, explicit non-implemented scope, privacy model, architecture, setup, checks, and documentation entry points.
- Reviewed `README.md`, `CHANGELOG.md`, `docs/privacy.md`, `docs/security.md`, and `docs/architecture.md` for consistency with the actual Sprint 5 implementation.
- Cut the `v0.5.0-alpha` changelog entry.
- Added `docs/RELEASE_CHECKLIST.md`.
- Added a short near-term section to `docs/roadmap.md`.
- Added an explicit documentation-sync rule to the project's internal contributor/agent instructions (kept local-only, not part of the public repository).
- Added a real IndexedDB unit test for `@free-ai-open/conversation-store` using `fake-indexeddb`.
- Added memory fallback coverage for the no-IndexedDB path.
- Added active conversation ID pointer tests for save/read/clear and localStorage failure handling.
- Strengthened local-log privacy coverage for `conversation`, `conversations`, and `messages` fields.
- Added an explicit diagnostic-report privacy test proving conversation-shaped input does not export `conversation`, `conversations`, or `messages` fields.
- Re-ran the conversation-store network isolation test to verify no `fetch`/`sendBeacon` path is used by store operations.

### Known limitations after Sprint 5.1

- No application behavior changed.
- No Playwright or browser E2E framework was added; persisted chat refresh and delete confirmation remain release-checklist/manual smoke-test items until a browser test framework is introduced deliberately.
- The known limitations listed under Sprint 5 above still apply unchanged.

### Planned work (not implemented yet)

- Same as Sprint 5's planned work: local export/import (Sprint 6), then encrypted export, optional Google Drive sync, better model selection, and benchmarks.

## Sprint 5.2 - Public repository readiness

### Built

- Added `CONTRIBUTING.md` (setup, required checks, privacy/security expectations, documentation-sync expectation, code style, PR guidance).
- Added `SECURITY.md` (how to report a vulnerability without a dedicated security email yet, in-scope issue classes, current security posture).
- Added a "Privacy/security report" issue template asking whether an issue involves prompts, responses, conversations, documents, local logs, diagnostic reports, or unexpected network traffic.
- Expanded the pull request template with changes-made, local storage impact, and diagnostic/logging impact sections and a more explicit checklist.
- Added `docs/PROJECT_OVERVIEW.md`: a public-facing explanation of what FreeAI Open is, why local-first browser AI is useful, current alpha status, what works today, what does not, the privacy model, and why the project is useful as open source.
- Clarified `docs/privacy.md`'s user-controls list to separate what is implemented today from what is planned.
- Added a performance-depends-on-browser/device/model note to `README.md` and linked the new docs from it.
- Reviewed `docs/architecture.md`, `docs/privacy.md`, `docs/security.md`, `docs/roadmap.md`, `PROJECT_BRIEF.md`, ADRs, and package READMEs for any claim that Supabase, Google Drive sync, or encrypted export/import are active; all were already correctly framed as not implemented/future.
- Re-verified internal workflow material remains local-only and is not part of the public repository.

### Known limitations after Sprint 5.2

- No application behavior changed; this sprint is documentation and repository-hygiene only.
- `SECURITY.md` does not yet have a dedicated contact email/private reporting address beyond GitHub's own mechanisms.
- The known limitations listed under prior sprints still apply unchanged.

### Planned work (not implemented yet)

- Same as prior sprints: local export/import (Sprint 6), then encrypted export, optional Google Drive sync, better model selection, and benchmarks.

## Sprint 6 - Core local conversation export/import

### Built

- Added `@free-ai-open/conversation-export`, a pure TypeScript package for versioned local JSON conversation export/import helpers.
- Defined export format `freeai-open-conversations` version `1` with `exportedAt`, `source`, and conversation payloads.
- Added `buildConversationExport`, `validateConversationExport`, `serializeConversationExport`, `parseConversationImport`, and `prepareImportedConversations`.
- Added strict import validation for format, version, conversation structure, message roles, canonical ISO dates, unexpected fields, conversation/message count limits, message length, title length, ID length, and JSON size.
- Added default conflict behavior that assigns fresh conversation IDs on import and never reuses imported IDs silently.
- Preserved valid titles, message roles, message content, and message timestamps in prepared imports.
- Added local import metadata (`source`, original ID, imported timestamp) to prepared imported conversations.

### Privacy and architecture notes

- Exported JSON may contain prompts and model responses because it is a user-controlled local backup format.
- The package does not call `fetch`, `sendBeacon`, server endpoints, Supabase, Google Drive, telemetry, local logs, or diagnostic reports.
- Diagnostic-report tests continue to ensure conversation-shaped import/export data is not exported in diagnostic reports.
- Exports are not encrypted; encrypted backup remains future work.

### Known limitations after Sprint 6 core

- No end-user import/export UI is wired yet.
- Prepared imports are core data objects; app-level persistence and user confirmation flows remain future integration work.
- Export/import browser E2E coverage is not added yet.

### Planned work (not implemented yet)

- Wire local export/import into the app UI with explicit user actions.
- Add browser-level coverage for import/export flows once the UI exists.
- Later: encrypted export and optional Google Drive sync.

## Sprint 6.1 - Local conversation export/import UI

### Built

- Added "Export current", "Export all", and "Import" actions to the `/chat` history sidebar (`ChatHistorySidebar` delegates to a new `ConversationExportImportControls` component).
- Export current builds a one-conversation export via `buildConversationExport`/`serializeConversationExport` and downloads it as a JSON file through a Blob/object URL; export all does the same for every locally stored conversation.
- Import reads the selected file client-side (`File.text()`), parses and validates it with `parseConversationImport`, and prepares conversations with fresh IDs via `prepareImportedConversations` so an import can never silently overwrite an existing conversation.
- Imported conversations are persisted using the existing `@free-ai-open/conversation-store` public API (`createConversation` with the prepared ID/title/`createdAt`, then `addMessage` per message) — no changes were made to `conversation-store` itself.
- Import shows a summary: conversations imported, conversations skipped (with a reason), and any validation errors, rendered directly in the sidebar without a page refresh.
- Added a persistent privacy note next to the export/import buttons: exported files contain conversation text, are not encrypted, and are never sent anywhere.
- Export/import buttons are disabled while a reply is generating or cancelling, consistent with the existing new-chat/select/rename/delete guard.

### Privacy and architecture notes

- The export/import UI calls only `@free-ai-open/conversation-export` and `@free-ai-open/conversation-store` public functions; it does not call `fetch`, `sendBeacon`, Supabase, Google Drive, `logEvent`, local technical logs, or diagnostic reports.
- No new dependency was added to `packages/conversation-store`; the app layer composes both packages' existing public APIs.

### Known limitations after Sprint 6.1

- Export/import has no dedicated browser end-to-end test yet; verified manually (export current, export all, import valid file, import invalid file, imported conversations appearing live, stop/reload still working).
- Imported conversations get a fresh `updatedAt` as messages are added back one by one through the public store API, rather than exactly preserving the original export's `updatedAt` timestamp.
- Bulk-importing near the existing conversation-store cap (100 conversations) can prune older conversations, the same as creating that many conversations any other way; import does not warn about this specifically.
- No cloud sync, encrypted export, or Google Drive integration was added.

### Planned work (not implemented yet)

- Encrypted export and optional Google Drive sync (see `docs/roadmap.md`).
- Browser-level end-to-end coverage for the export/import UI.

## Sprint 6.2 - UX polish, i18n, and theme

### Built

- Added a small English/French translation system for `apps/web`: per-locale dictionaries (`en.ts`, `fr.ts`) with a dot-path `t()` lookup and `{param}` interpolation, a `LocaleProvider`/`useTranslations()` React context, and a visible EN/FR toggle in the header. Detects `navigator.language` on first visit and persists the choice in `localStorage`; no server or API call is involved.
- Translated the explicitly in-scope surfaces: home/app shell (header, footer, home page, privacy notice), `/chat` (heading, model/runtime status text, notices, transcript empty state, Stop/Send/Reload model), the conversation history sidebar (new chat, rename/delete, confirmation, empty states), export/import (buttons, privacy note, import result summary, errors), the `/debug` dashboard (all sections, actions, status messages), and runtime status/error labels.
- Added light/dark/system theme support: CSS custom-property color tokens defined in `globals.css` for dark (default) and light, a `ThemeProvider`/`useTheme()` React context, a visible System/Light/Dark toggle in the header, and `localStorage` persistence. A blocking inline `<script>` in the root layout applies a stored light/dark choice to `<html data-theme>` before hydration to avoid a flash of the wrong theme; "system" intentionally leaves the attribute unset and lets a `prefers-color-scheme` media query decide. Added `suppressHydrationWarning` on `<html>` since this script deliberately changes an attribute before React hydrates.
- Replaced hardcoded hex/rgba colors across `apps/web` (chat, history sidebar, export/import, debug dashboard, onboarding, home) with the new color tokens, so both themes render correctly instead of only the original dark palette.
- Fixed a mobile layout issue: the `/chat` sidebar's fixed 240px width left very little room for the conversation on narrow viewports; added a `max-width: 720px` media query that stacks the sidebar above the chat instead.
- Added accessible labels: `aria-label` on the message input and per-conversation rename/delete buttons (including the conversation title, since multiple conversations can share a title), `aria-pressed` on the language/theme toggle buttons, `aria-current` on the active conversation, and `aria-live`/`role="status"`/`role="alert"` on notice banners so dynamic updates are announced.
- Clarified wording in both languages for import results, invalid files, storage-unavailable states, and runtime errors, without changing the underlying behavior.

### Privacy and architecture notes

- Translation dictionaries are plain data shipped in the client bundle; no text is sent to or fetched from a server, and no AI runtime call is involved in translation.
- Theme and locale preferences are stored under two new `localStorage` keys (`free-ai-open:theme`, `free-ai-open:locale`) containing only the preference value, never conversation content.
- No changes were made to `packages/conversation-store`, `packages/conversation-export`, `packages/diagnostic-report`, or any logging/telemetry path; diagnostic reports and local technical logs still exclude conversation content, verified manually via a diagnostic export during this sprint's smoke test.

### Known limitations after Sprint 6.2

- Translation coverage is intentionally scoped to the areas listed in "Built" above; onboarding (task/device/mode selection), `/settings`, the model catalog (`_lib/catalog.ts`), and model-router explanation text (`humanReadableReason`, rejection reasons) remain English-only. Onboarding and settings did get the same color-token treatment, so they still render correctly in light mode.
- The language switch takes effect the render after mount (a brief flash from the default "en" to the detected/stored language is possible); the theme switch avoids this via the blocking inline script, since a full-page background/color flash is more visually jarring than a text-language flash.
- No dedicated browser end-to-end test for language/theme persistence or the mobile layout fix yet; verified manually in this sprint (language switch + refresh, theme switch + refresh, mobile viewport check).

### Planned work (not implemented yet)

- Extend translation coverage to onboarding, settings, and model/task catalog text.
- Encrypted export and optional Google Drive sync (see `docs/roadmap.md`).
- Browser-level end-to-end coverage for import/export, language, and theme.

## Sprint 6.3 - Generation safety and message containment

### Built

- Added alpha generation safety limits in `@free-ai-open/ai-runtime`: `max_tokens: 768`, maximum generation duration of 90 seconds, maximum output length of 12,000 characters, and lightweight checks for long unbroken sequences, repeated characters, and repeated punctuation/symbol blocks.
- Added `degenerate_output` and `generation_timeout` runtime error codes, with technical-only local log events (`inference.degenerate-output`, `inference.generation-timeout`) and English/French user-facing messages.
- Updated the chat persistence path to use the simpler Option A behavior: cancelled, stalled, timed-out, failed, or degenerate assistant partial output is discarded, the assistant bubble is removed, and the partial response is not saved as a completed assistant message. The user prompt remains saved locally when conversation storage is available.
- Added message layout containment for chat bubbles: long strings wrap inside the bubble, and future `pre`/`code` blocks scroll horizontally instead of expanding the page width.

### Privacy and architecture notes

- No message status field was added to `conversation-store` or the export/import format, so existing conversation JSON remains valid.
- Technical events, local logs, and diagnostic reports are limited to event names, runtime status, error codes, lengths where applicable, and timing metrics. They do not include prompt text, generated response text, documents, messages, or conversations.
- No server endpoint, `fetch`, `sendBeacon`, Supabase, Google Drive, or cloud sync path was added.

### Tests

- Added unit coverage for degenerate output detection (long unbroken sequences, repeated characters, repeated symbol blocks, output length).
- Added unit coverage proving cancelled, stalled/timed-out, failed, and degenerate assistant output is not considered persistable as a completed reply.
- Added runtime tests for WebLLM `max_tokens`, `degenerate_output` recovery, `generation_timeout`, and technical-only logs.

### Known limitations after Sprint 6.3

- These are alpha safeguards, not a guarantee of model quality.
- Browser-level layout and export smoke coverage is still manual; add dedicated browser/E2E coverage later.

## Sprint 6.4 - v0.6.2-alpha i18n completion and runtime recovery

### Built

- Completed English/French coverage for user-facing strings across home, onboarding, settings, app shell/navigation, chat, conversation history, export/import controls, debug dashboard, runtime status badges, model loading/recovery states, empty states, errors, confirmations, privacy warnings, theme/language controls, and accessibility labels.
- Converted the task catalog, performance mode catalog, model-status text, and model-router explanation text to translation keys instead of hardcoded English.
- Added a stricter translation helper: missing localized keys throw in development/tests and fall back to English in production-like use.
- Added runtime-only language instructions before each WebLLM inference based on the selected UI locale:
  - French: "Réponds en français par défaut. Utilise une autre langue uniquement si l’utilisateur le demande explicitement."
  - English: "Reply in English by default. Use another language only when the user explicitly requests it."
- Changing the UI language affects subsequent generations without recreating the conversation.
- Added automatic post-cancellation recovery: after Stop confirms, the partial assistant output is discarded, the interrupted runtime stays out of `ready`, the worker is torn down, a replacement worker/runtime is created, and the cached model is reloaded before send is enabled again.
- Added the `recovering` runtime status across `ai-runtime`, local logs, diagnostic reports, debug dashboard display, and runtime status labels.
- Added technical recovery events: `runtime.recovery.started`, `runtime.recovery.completed`, and `runtime.recovery.failed`.

### Privacy and architecture notes

- The hidden language instruction is never persisted in conversation history, never shown in the chat UI, never exported with conversations, never included in diagnostic reports, and never written to local technical logs.
- Language adherence is best effort and depends on the local model; FreeAI Open does not claim every model can answer correctly in French.
- Recovery logs stay technical-only: event name, severity, runtime status, and error code where applicable.
- No `fetch`, `sendBeacon`, Supabase, Google Drive, cloud sync, server endpoint, or server-side WebLLM path was added.

### Tests

- Added catalog-key parity tests for English/French dictionaries.
- Added representative translation coverage tests across public routes/components and fallback behavior.
- Added locale preference persistence tests.
- Added runtime tests for English/French hidden system-message injection, locale changes between generations, no logging of instructions, replacement runtime generation after cancellation, repeated Stop clicks, and `recovering` model loads.
- Added local-log and diagnostic-report tests for `runtimeStatus: "recovering"`.
- Added tests proving hidden language instructions are not exported with conversations or included in diagnostic reports.

### Known limitations after v0.6.2-alpha

- Model response language is best effort; future routing should prefer French-capable or multilingual models when French is selected.
- Browser smoke coverage for switching languages, repeated Stop/recovery cycles, export privacy, and theme persistence remains manual until a browser-level test suite is introduced.
- The model catalog remains intentionally small.

## Sprint 6.5 - v0.6.3-alpha mobile conversation navigation

### Built

- Replaced the mobile-only `.chat-sidebar` stacking behavior (a single `max-width: 720px` media query that stacked the history sidebar above the chat, added in Sprint 6.2) with an accessible off-canvas drawer: a menu button in the chat header (`history.openHistory`) opens a fixed overlay panel containing New chat, conversation history (select/rename/delete), and the export/import controls.
- Added `apps/web/app/_lib/mobileHistoryDrawer.ts`, a small pure reducer covering the drawer's open/close transitions (`open`, `close`, `select-conversation`, `new-chat`, `escape`, `backdrop-click`, `viewport-desktop`), and `apps/web/app/_components/useMobileHistoryDrawer.ts`, a hook wiring that reducer to DOM behavior: Escape-to-close, backdrop-click-to-close, background scroll lock while open (mobile only), focus restoration to the trigger button on close, and automatic close when the viewport becomes desktop-sized.
- Added `apps/web/app/_components/ChatHistoryDrawerPanel.tsx`, which wraps the existing, unmodified `ChatHistorySidebar` with a backdrop, dialog semantics (`role="dialog"`/`aria-modal`/`aria-label`, applied only at mobile viewport widths), a mobile-only close button, and `inert` on the closed off-canvas panel so it isn't keyboard-reachable while hidden.
- Selecting a conversation or starting a new chat from the drawer closes it automatically; deleting a conversation continues to use the existing `handleDeleteConversation` logic unchanged, so deleting the active conversation still leaves the interface in a valid state.
- On desktop (≥721px) the new wrapper renders as a plain pass-through block around the same sidebar markup, so desktop proportions, the fixed 240px sidebar width, and all existing selection/rename/delete/import/export behavior are unchanged.
- Added `history.title` ("Conversations"), `history.openHistory` ("Open conversation history"), `history.closeHistory` ("Close conversation history"), `history.importConversations` ("Import conversations"), and `history.exportConversations` ("Export conversations") translation keys to both `en.ts` and `fr.ts`; the latter two also replace the export button group's and import file input's accessible labels for clarity.
- Added CSS-only responsive behavior in `globals.css`: the trigger button, backdrop, and panel header are hidden by default and only enabled inside the existing `max-width: 720px` media query, so no JavaScript viewport polling drives the visual layout — a `matchMedia` listener is used only to correct ARIA semantics and force-close the drawer if the viewport crosses the breakpoint while open.

### Privacy and architecture notes

- The drawer is purely a presentation change: it reuses the existing `ChatHistorySidebar` and `ConversationExportImportControls` components and their existing local-only handlers unmodified, so no new network path, server endpoint, `fetch`, `sendBeacon`, Supabase, Google Drive, or cloud sync path was introduced.
- No new local storage keys, telemetry fields, or local technical log events were added; the drawer's open/closed state is transient React state, not persisted.

### Known limitations after Sprint 6.5

- Drawer open/close/Escape/selection-closes behavior is covered by a pure-logic unit test (`_lib/mobileHistoryDrawer.test.ts`); there is no component-rendering or browser-level automated test for the drawer's DOM/focus/scroll-lock behavior, since the project does not use a DOM rendering test library yet. See `docs/RELEASE_CHECKLIST.md` for the corresponding manual mobile checks.
- The drawer's width (`min(320px, 85vw)`) and breakpoint (720px) are fixed values chosen from manual testing on a Redmi Note 13 Pro 5G viewport; they are not yet configurable or verified across a wider device matrix.

### Planned work (not implemented yet)

- Broader browser/E2E coverage for the mobile drawer alongside the rest of the app (see "Cross-cutting remaining work" below).
- Extending the same off-canvas drawer pattern to other panels if further mobile navigation needs arise.

## Sprint 6.6 - v0.6.3-alpha streaming render responsiveness

### Built

- Audited the `/chat` streaming path and found the main UI bottleneck: every tiny WebLLM token chunk appended text through `setMessages`, remapped the full messages array, and rerendered the chat page subtree even though only the active assistant bubble changed.
- Added `apps/web/app/_lib/streamingBuffer.ts` with a named `STREAM_RENDER_INTERVAL_MS` constant. The runtime stream is unchanged; the UI batches visible assistant text updates and flushes pending text on completion, cancellation, error, or disposal.
- Preserved every generated character in the in-memory `assistantText` accumulator used for completion handling and local persistence decisions. The render buffer only controls when React sees visible updates.
- Added `apps/web/app/_lib/chatAutoscroll.ts` and wired the transcript to follow streaming output only while the user is near the bottom. Scroll work is scheduled through `requestAnimationFrame`, and a translated "Scroll to latest" button appears when the user has scrolled away.
- Memoized individual chat message bubbles plus the history drawer/sidebar/export controls, with stable callbacks from `/chat`, so unchanged history/import/export UI does not rerender on each buffered transcript flush.

### Privacy and architecture notes

- The buffering layer is local UI state only. It does not call `fetch`, `sendBeacon`, Supabase, Google Drive, telemetry, local technical logs, diagnostic reports, or any server endpoint.
- Generated text remains forbidden in logs and diagnostics. The buffer contains generated text only in memory long enough to update the visible assistant bubble.
- No WebLLM runtime behavior, model selection, conversation export/import format, or diagnostic schema changed.

### Tests

- Added unit tests for chunk coalescing without character loss, interval timing, flush-on-completion, flush-on-cancellation/error disposal, and independence from locale/theme state.
- Added unit tests for near-bottom autoscroll decisions, including the case where a user has intentionally scrolled away from the latest message.
- Kept browser-level scroll/focus/performance checks in `docs/RELEASE_CHECKLIST.md` because the project still does not have a DOM rendering or browser E2E test layer.

### Known limitations after Sprint 6.6

- The transcript is not virtualized. Very long imported conversations may still benefit from future windowing/virtualization, but no new dependency was added in this sprint.
- Browser smoke testing is still required to validate perceived smoothness on real mobile devices.

## Sprint 6.7 - v0.6.4-alpha mobile navigation fix and device tier accuracy

### Built

- Fixed the mobile "show previous conversations" control: it was still a normal-flow button inside the chat heading row, so scrolling down a long conversation scrolled it out of view. `.chat-history-trigger` is now `position: fixed` in the top-right corner on mobile (`max-width: 720px`), with `env(safe-area-inset-top/right)` offsets, a `z-index` above the drawer panel/backdrop, and a `padding-top` clearance added to `.chat-layout` so the fixed button never overlaps the chat heading row underneath it.
- Enabled `viewport-fit: cover` via a new `viewport` export in `apps/web/app/layout.tsx` so `env(safe-area-inset-*)` actually resolves to non-zero values on notched/rounded-corner devices; without it the safe-area CSS was a silent no-op.
- The trigger button now toggles (`mobileHistoryDrawerReducer` gained a `toggle` action) instead of only opening, its visible label switches between "Open conversation history" and "Close conversation history" to match `aria-expanded`, and it hides itself while the drawer is open (the drawer already has its own close button, backdrop, and Escape handling, and hiding the trigger avoids it visually colliding with the open panel's right edge on narrow viewports).
- Fixed the drawer's keyboard focus lifecycle: opening the mobile drawer moves focus to the visible close button, closing through the close button/Escape/backdrop/conversation selection/new chat restores focus to the trigger when it still exists, and the chat background is isolated with `inert` where supported plus a focus redirection guard so keyboard focus cannot move behind the overlay.
- The drawer panel itself already lived outside the normal document flow, already overlaid the chat instead of pushing it down, and already supported all required close paths, full-height presentation, scroll locking, and reduced-motion; this sprint fixes the trigger positioning, adds safe-area padding to the panel, and completes focus/background isolation.
- Audited why a Redmi Note 13 Pro 5G (12 GB RAM) was classified `webgpu_high`/tier 3, identical to many desktop PCs: `getDeviceTier` derived the tier almost entirely from `estimatedMemoryGb` (`>=8 GB` alone was enough for tier 3) with no form-factor awareness at all.
- Replaced that threshold ladder with a small scoring model in a new `packages/device-profiler/src/scoring.ts`: bounded points for coarse memory/CPU-concurrency/WebGPU-backend signals (2/2/1 max), a form-factor tier cap (mobile capped at 2, tablet at 3, unknown at 3, desktop uncapped) so RAM and core count alone can never place a phone alongside desktop-class hardware, and optional measured-tokens-per-second promotion / repeated-failure demotion that only ever move the tier when real data is supplied.
- Added `packages/device-profiler/src/capabilities.ts` with the new coarse detectors: `detectFormFactor` (UA-CH mobile hint + user-agent heuristics, including an iPadOS Safari desktop-style check that runs before generic macOS classification when `Macintosh`/`Mac OS` and multitouch signals are present), `detectArchitectureClass` (Client Hints `getHighEntropyValues(["architecture"])`, never guessed from OS family since e.g. Apple Silicon Macs are ARM), `classifyMemory`, `classifyCpuConcurrency`, and `detectCpuConcurrency` (`navigator.hardwareConcurrency`).
- `DeviceProfile` now includes `formFactor`, `architectureClass`, `memoryClass`, `cpuConcurrencyClass`, and an optional `measuredPerformance` echo of whatever was supplied to `buildDeviceProfile`. `deviceTier` stays a plain `0–4` `DeviceTier`, so `model-router` needed no logic changes — its legacy `routeModel()` tier-only input path now reports the new fields as `"unknown"` instead of guessing.

### Privacy and architecture notes

- Every new field is a coarse, bounded category (4 or fewer values) or an optional locally-supplied measurement — never a raw sensor value, a raw user-agent string, or anything unique enough to fingerprint a device. The iPadOS heuristic consumes `userAgent` and `maxTouchPoints` only inside the browser to choose the coarse `tablet` bucket; those raw values are not exposed in `DeviceProfile`, logged, diagnosed, or transmitted. Nothing new is transmitted anywhere; `detectDeviceProfile()` remains a synchronous, local-only, no-network call.
- `measuredPerformance` is a clean, tested interface, not a faked one: `buildDeviceProfile`/`getDeviceTier` accept it and promote/demote correctly when it's supplied, but no current caller (`apps/web`'s onboarding/chat flow) actually sources it from real `@free-ai-open/local-logs` history yet — see "Planned work" below and `docs/architecture.md`.

### Tests

- Added mobile-history-drawer reducer coverage for the new `toggle` action.
- Added mobile drawer accessibility helper coverage for focus transfer into the drawer, focus restoration to the trigger, background `inert`/`aria-hidden` isolation cleanup, and focus redirection when a background element receives focus while the drawer is open.
- Rewrote `packages/device-profiler/src/index.test.ts`'s tier-related assertions for the new scoring model and added coverage for: WebGPU absence forcing tier 0 regardless of memory; memory alone never reaching tier 3; iPadOS Safari desktop-style user agents with multitouch classifying as `tablet`; normal macOS desktops with zero/single-touch reports staying `desktop`; contradictory iPad-style signals falling back to `"unknown"`; high-RAM tablets not reaching tier 3 from memory alone; a 12 GB mobile phone staying at tier ≤2 from coarse signals; a 12 GB desktop reaching a higher tier than an identical-memory mobile device; a low-memory desktop staying conservative; a mobile device with WebGPU but high coarse scores still staying ≤2 without measurements; strong measured tokens/sec promoting a mobile device; weak measured performance not promoting; repeated failures demoting by one tier with a tier-1 floor; and safe `"unknown"` fallbacks when Client Hints/`hardwareConcurrency`/UA signals are unavailable.
- Added a test asserting the profile never exposes raw `hardwareConcurrency`, `userAgent`, or `maxTouchPoints` values, only the coarse categories.
- Updated `model-router` and `diagnostic-report` test fixtures for the new required `DeviceProfile` fields without changing any router/diagnostic-report assertions or behavior.

### Known limitations after Sprint 6.7

- `formFactor`/tablet detection is still a best-effort heuristic. iPadOS Safari desktop-style user agents are now treated as `tablet` only when the local `Macintosh`/`Mac OS` user-agent shape is paired with multitouch support and no reliable contradictory signal; genuinely contradictory signals fall back to `"unknown"` instead of a high-confidence desktop classification.
- `architectureClass` depends on the Client Hints high-entropy API (`navigator.userAgentData.getHighEntropyValues`), which is Chromium-only today; other browsers will report `"unknown"`.
- The scoring thresholds and tier caps were chosen from the mission's stated rules and manual reasoning about the Redmi Note 13 Pro 5G, not from a device benchmark corpus; they may need tuning once more real device data is available.
- `measuredPerformance` is not yet wired to real `@free-ai-open/local-logs` history in the live app; no current call site promotes or demotes a device based on actual generation performance yet.

### Planned work (not implemented yet)

- v0.7: source `measuredPerformance` from a device's own recent local generation history (tokens/sec, load time, first-token time, recent stall/error count) before building the device profile used for model recommendations, so real performance can promote or demote a tier over time.
- v0.7: use the refined tier (and eventually `formFactor`) in `model-router` to prefer mobile-compatible/lightweight models on capped-tier devices and performance-tier models on promoted ones, and to prefer French-capable/multilingual models when French is selected (see `docs/roadmap.md`).

## Sprint 6.8 - v0.6.5-alpha brand foundation

### Built

- Added a first brand/design-system foundation in `apps/web/app/globals.css` using the FreeAI Open brand guide: source palette tokens, semantic `--fo-*` tokens, light/dark/system values, typography, spacing steps, radii, focus ring, motion durations, overlay shadow, and compatibility aliases for existing `--color-*` variables.
- Generated production PNG web assets from the local square app-icon source into `apps/web/public/brand/`: `freeai-open-app-icon.png`, `favicon.png`, `apple-touch-icon.png`, `pwa-icon-192.png`, and `pwa-icon-512.png`.
- Added a compact `BrandMark` component for navigation. It uses the square symbol asset and renders `FreeAI Open` as real HTML text; the large horizontal raster reference remains a local-only design reference and is not used in the interface.
- Updated Next.js metadata to reference the public favicon and Apple touch icon assets.
- Applied the foundation to shared/high-leverage surfaces only: header, footer, language/theme segmented controls, status badges, privacy notice, debug sections/actions, and primary home/onboarding CTAs. This sprint deliberately does not perform a full page-by-page redesign.
- Added `docs/brand.md` as public brand guidance for logo usage, asset locations, colors, typography, accent discipline, accessibility, and the known lack of a true vector logo source.

### Privacy and architecture notes

- Brand-source files remain local-only under `.local/brand-source/`; the raw DOCX and large horizontal reference image are not committed.
- The visual foundation does not change runtime behavior, model routing, local storage, telemetry, diagnostic reports, local technical logs, or server behavior.
- No `fetch`, `sendBeacon`, Supabase, Google Drive, cloud sync, new endpoint, third-party font CDN, or third-party design service was added.

### Known limitations after v0.6.5-alpha

- The public assets are production-ready PNGs, not a true vector logo system. Proper vector reconstruction is still future brand work.
- Many app surfaces still use local inline layout styles; they inherit the new tokens but have not been fully redesigned into shared components yet.
- Browser-level visual regression coverage remains manual.

## Sprint 6.9 - v0.6.5-alpha product-wide redesign completion

### Built

- Completed the redesign the brand foundation sprint deliberately deferred: every remaining app surface (home, all four onboarding steps, chat, conversation history, import/export, debug, settings) now uses the shared `--fo-*` token system and `.fo-*` classes instead of local inline colors and ad-hoc spacing.
- Added a responsive application shell in `apps/web/app/_components/Header.tsx`: a compact, always-Ink vertical navigation rail on desktop (brand icon, Home/Chat/Settings/Debug links with `aria-current`, language/theme toggles) and a compact fixed, safe-area-aware top bar on mobile with a small dropdown menu holding the same links/toggles. Both blocks of markup render unconditionally; the existing 720px breakpoint used everywhere else in the app decides which is visible, so there is still exactly one responsive rule to reason about. `apps/web/app/layout.tsx` now wraps `<Header/>` and `{children}` in an `.app-shell`/`.app-shell__content` flex structure instead of stacking a plain top header above the page.
- Added a small hand-rolled line-icon set (`apps/web/app/_components/icons.tsx`) for the nav (home, chat, settings, debug, menu, close) — simple 1.75px strokes per the brand guide, no icon library dependency added.
- Added `apps/web/app/_components/DeviceCapabilitySummary.tsx`, a shared presentational component (device profile in, plain-language capability summary + advanced-details disclosure out) that replaces the near-duplicate device-check markup previously hand-written on the home and onboarding/device pages. It maps `(webgpuAvailable, deviceTier)` to one of four public-facing categories — "Limited compatibility", "Suitable for lightweight models", "Recommended experience", "High-performance device" — via a new pure `describeDeviceCapability()` helper in `apps/web/app/_lib/deviceRecommendation.ts`, with boundaries that intentionally mirror the existing `recommendPerformanceMode()` so the label a user sees always matches the mode the app actually recommends. The raw numeric tier, backend, memory, and storage figures move behind an "Advanced technical details" disclosure, never removed, just no longer the default view.
- Added a "Use the recommended setup" primary call to action on the home page that links straight to a working `/chat?task=chat&mode=<recommended>` session once local device profiling has resolved — the previous "Skip to chat" link went to a bare `/chat` with no `task`/`mode` query parameters, which meant `chat/page.tsx`'s runtime-initialization effect (gated on both being present) never ran and the local model never loaded. "Get started" remains as the secondary path into the full onboarding/customization flow.
- Highlighted the device-recommended performance mode on `/onboarding/mode` with a "Recommended for this device" badge, computed the same way the recommended-setup link picks its default.
- Renamed the "Performance" mode's *display* label only, to "Quality" (English) / "Qualité" (French); `PerformanceMode`'s `"performance"` value, `catalog.ts`, and all router/compatibility logic are byte-for-byte unchanged.
- Added a `runtimeStatusPlain.*` translation namespace with the mission's suggested plain-language runtime wording ("Preparing the local model", "Ready on this device", "Writing a response", "Stopping", "Preparing the model again", "Something went wrong") and switched `RuntimeStatusBadge` (the normal chat interface) to it; the existing `runtimeStatus.*` namespace is kept for technical/debug use.
- Added a "Technical details" `<details>` under the local-model-unavailable error banner showing the raw `RuntimeErrorCode` in monospace; the default, always-visible message stays the existing plain-language `runtimeError.*` sentence plus the "Reload model" action.
- Converted the chat composer from a single-line `<input>` to a multiline `<textarea>` (2 rows, vertically resizable, 44px minimum height): Enter sends, Shift+Enter inserts a newline, `enterKeyHint="send"` hints mobile keyboards to show a "Send"-labeled return key, and a small composer hint ("Enter to send, Shift+Enter for a new line.") is shown beneath it with safe-area bottom padding on mobile.
- Added a screen-reader-only role label ("You" / "Local assistant") inside each chat message bubble, so the user/assistant distinction — currently alignment plus a subtle neutral surface difference, deliberately not a strong color — is also available to assistive technology that doesn't perceive layout.
- Restyled the conversation history list for a clearer active state (accent-soft background, a 3px left accent stripe, and bold text — not color alone) and quieter rename/delete controls (minimal underlined text instead of bordered buttons), addressing "rename/delete available but not visually noisy" without changing any of the underlying handlers.
- Made `/debug` predominantly Ink regardless of the selected site theme by scoping the semantic `--fo-*` custom properties themselves inside a new `.fo-ink-surface` wrapper, rather than restyling individual components — every existing `--fo-*`-based class and component (`.fo-card`, `.fo-button-secondary`, `.fo-muted`, `PrivacyNotice`, …) therefore resolves to the correct ink-forced colors automatically inside that scope instead of needing a parallel "ink" variant of every class.
- Applied the brand guide's monospace discipline to the debug dashboard: `DebugField` gained an explicit `technical` prop, set only on genuinely technical values (backend, device tier, form factor, model source/status/estimated size/license, load time, first-token time, tokens/sec, log timestamps/events/error codes, `contentLogged`); labels and explanatory sentences stay in the normal sans-serif font. The debug dashboard's runtime-status field now shows the raw status code instead of a translated word, and gained a new `formFactor` field surfacing the coarse device-profiler signal added in Sprint 6.7.
- Extended `docs/brand.md` with the parts of the source brand guide not yet captured in the public doc: the 80% neutral / 15% secondary-surface / 5% teal-maximum color-usage rule, the full display/H1/H2/H3/body/label/code typography scale, per-component treatment rules (primary/secondary button, field, card, active-local-state, logs/diagnostic surface), imagery guidance (what to use, what to exclude — explicitly no glowing brains, humanoid robots, decorative neural networks, or purple/blue "AI" gradients), and editorial tone-of-voice "say this / avoid this" examples.

### Privacy and architecture notes

- No WebLLM runtime, Stop/recovery, conversation storage, import/export, runtime language injection, device profiler, theme, or diagnostic-report logic changed. This sprint is presentation and copy only; every behavioral change (the recommended-setup link, the recommended-mode badge, the "Quality" label rename) is either a corrected navigation target or a translation-string change, not new business logic.
- `DeviceCapabilitySummary` and the debug dashboard's new `formFactor` field read only existing, already-reviewed coarse `DeviceProfile` fields (see Sprint 6.7). No new device signal was added, and nothing new is transmitted; device profiling remains a local, synchronous, no-network call.
- The composer's `<textarea>` change and the message role label are UI/accessibility changes only; they do not touch prompt/response handling, local persistence, or the buffered streaming path from Sprint 6.6, which is otherwise unmodified.

### Tests

- No new automated tests were added for the shell/redesign itself — it is presentation, styling, and copy over already-tested logic (drawer reducer/hook, conversation store wiring, Stop/recovery, import/export validation, device-profiler scoring), and the project deliberately does not add a component-rendering or browser E2E framework for this. Existing coverage (drawer behavior, EN/FR catalog-key parity, locale/theme persistence, generation-safety/persistence decisions, device-profiler scoring, no-content-in-logs privacy tests) was re-run unchanged and confirmed still passing after the redesign; see `docs/RELEASE_CHECKLIST.md` for the expanded manual visual/accessibility checklist covering the new shell, composer, and debug surfaces.

### Known limitations after Sprint 6.9

- The redesign is presentation-layer; it does not add new UI test coverage beyond what already existed for the underlying logic. Visual regression coverage remains manual.
- The mobile top bar's dropdown menu is a small hand-built disclosure (state + Escape + outside-click), not a shared, reusable "popover" primitive; if a third or fourth place in the app needs the same pattern, it's worth extracting one then rather than duplicating it a third time.
- `describeDeviceCapability()`'s four-category mapping and the "Quality" mode label are UX/copy decisions based on the mission's stated guidance, not user-tested wording.
- The public logo assets are still production PNGs, not a true vector logo system (unchanged from Sprint 6.8; still future brand work).

## Sprint 6.10 - v0.6.5-alpha review fixes

### Built

- Corrected the home "Use the recommended setup" CTA so it shares the same `deviceRecommendation.ts` source of truth as `/onboarding/mode`. Once local profiling resolves, tier 0/1 devices route to `fast`, tier 2/3 devices route to `balanced`, and tier 4 devices route to `performance`. While profiling is pending, the CTA shows a detection state instead of hardcoding `balanced`.
- Introduced accessible light-mode semantic text colors: muted text now uses `#68707A`, and small teal text uses `--fo-accent-text` (`#007E68`) while the brighter brand teal values remain available for accent fills, borders, focus, and active decoration.
- Raised mobile/coarse-pointer touch targets to 44px for language/theme segmented controls, the mobile history trigger, drawer close control, conversation rename/delete/confirm/cancel actions, and import/export actions. Desktop can still use the compact variants where appropriate.

### Privacy and architecture notes

- Device recommendation still runs entirely in the browser through `detectDeviceProfile()` and the existing local `DeviceProfile.deviceTier`. No new device signal, server endpoint, `fetch`, `sendBeacon`, Supabase, Google Drive, telemetry path, local log, or diagnostic export path was added.
- The contrast and touch-target fixes are CSS/UI accessibility changes only. They do not touch prompts, responses, documents, conversation storage, model routing packages, WebLLM runtime code, or server behavior.

### Tests

- Added unit coverage for recommended chat destinations across low, normal, and strong tiers, plus the pending-profile state and home/onboarding source-of-truth consistency.
- Added WCAG contrast tests that calculate ratios from the actual CSS tokens for light and dark semantic text pairs.
- Added lightweight coverage for mobile touch-target CSS, accessible labels on icon/history controls, delete-confirm wiring, and theme preference persistence.

### Known limitations after Sprint 6.10

- The project still does not include a browser-level rendering/E2E framework. Exact rendered dimensions and visual readability across device emulation remain release-checklist manual smoke tests.

## Sprint 6.11 - v0.6.6-alpha part 1: shell, first-run persistence, per-conversation task

### Built

- Added a first-run "Getting Started" flow gating `/` and `/chat`: explain (existing `/onboarding` intro), detect the device (existing `/onboarding/device`), recommend and confirm a performance mode (rewritten `/onboarding/mode`, now step 2 of 2 — the task-selection step and `/onboarding/task` are removed), persist the choice, mark completion, and continue straight to `/chat`. Getting Started is shown once and only reappears after `resetGettingStarted()` (from Settings) or the browser's site data being cleared.
- Added `apps/web/app/_lib/gettingStartedPreference.ts`: a single, schema-versioned `localStorage` record (`free-ai-open:getting-started`) holding `completed`, `performanceMode`, and an optional coarse `device` snapshot (tier, WebGPU availability, form factor), following the same window-guarded/try-catch convention as `themePreference.ts`/`localePreference.ts`.
- Added per-conversation usage selection: `NewChatTaskDialog` is a small accessible modal (focus trap, Escape/backdrop close, background scroll lock, focus restoration to whatever triggered it) offering the existing `TaskCategory` catalog minus `document_analysis` (no document upload entry point exists yet, so offering it would promise a capability the product doesn't have). Selecting a task immediately creates the conversation with that task in its metadata, opens it, and closes the dialog; the performance mode is never asked here.
- Reworked `/chat`: task/mode are no longer read from the URL. The performance mode comes from `gettingStartedPreference`; the active conversation's task comes from its own stored metadata via a new `resolveConversationTask()` helper in `_lib/catalog.ts`, defaulting missing/invalid values to `"chat"`. The model-router recommendation panel now depends on `[activeConversationTask, performanceMode]` and recomputes on either change; the WebLLM worker/runtime lifecycle depends only on `performanceMode` being loaded, since this alpha always loads the same placeholder model regardless of the routing recommendation shown.
- Added an optional `task` field to `@free-ai-open/conversation-store` (`ConversationMetadata`/`CreateConversationInput`) and to `@free-ai-open/conversation-export` (`ConversationExportConversation`, added to the validator's allowed-key set with a bounded-string check). Format/version are unchanged (`freeai-open-conversations` / `1`); older conversations and older export files without `task` remain fully valid, and the store/export layers only ever pass the value through — no new cross-package dependency was added to keep `task` as an app-validated `TaskCategory` at the storage boundary.
- Redesigned `/settings`: performance mode (plain-language explanation, pick-then-explicit-"Save" flow so a change is never applied silently and can't interrupt a reply that's currently generating elsewhere), language (`LanguageToggle`), theme (`ThemeToggle`), "Re-check this device" (re-runs `detectDeviceProfile()` inline), and "Reset first-time setup" (confirm step, then `resetGettingStarted()` + redirect to `/onboarding`). Device profile, the exact `PerformanceMode` value, and the local model ID (`DEFAULT_MODEL_ID`) sit behind an "Advanced technical details" disclosure.
- Fixed the desktop navigation rail's selected-control contrast: `.app-shell__rail` now forces its semantic tokens (`--fo-text`, `--fo-accent-soft`, `--fo-accent-text`, `--fo-border`, …) to dark-surface values, the same technique `.fo-ink-surface` already uses for `/debug`. Previously the rail's language/theme toggle mixed hardcoded Paper text with the page's theme-following `--fo-accent-soft`, so a light site theme produced white text on a very light teal background for the selected option. The rail-specific pressed-state override is removed entirely; the base `.fo-segmented button[aria-pressed="true"]` rule now resolves correctly inside the rail's forced-dark scope on its own.
- Added a dedicated desktop chat workspace: `apps/web/app/chat/layout.tsx` wraps `/chat` in a `.chat-shell` div, and new `@media (min-width: 721px)` rules in `globals.css` let the root app shell own `height: 100dvh` while `/chat` fills the remaining app-main height below any global runtime status strip. The sidebar (`.chat-history-list`) and message transcript (`.chat-main__scroll`) scroll independently, the composer stays bottom-anchored (`.chat-main__composer`), and every intermediate flex region uses `min-height: 0` so scroll regions shrink instead of stretching the document. `ChatTranscript` now follows the dedicated transcript scroll container on desktop, with page-scroll fallback for mobile. The page footer is hidden only on this route (`.app-shell__main:has(> .chat-shell) + .app-footer`), and only inside the same desktop media query — mobile's existing off-canvas drawer, normal document flow, and footer are completely unchanged.

### Privacy and architecture notes

- The Getting Started preference store holds only a completion flag, a `PerformanceMode` string, and coarse, already-privacy-reviewed device fields — never raw sensor values, never sent to a server.
- The per-conversation `task` field is a short catalog label, never prompt/response content. It flows through export/import the same way `title` already does, and import validation rejects a non-string/oversized value the same way it already rejects malformed titles.
- No `fetch`, `sendBeacon`, Supabase, Google Drive, cloud sync, new server endpoint, or server-side WebLLM path was added. No model-router selection algorithm, WebLLM runtime behavior, telemetry schema, or diagnostic-report schema changed.
- This is explicitly part 1 of v0.6.6-alpha — the mission scope excluded the full v0.7 model router integration (using `formFactor`/refined tiers to prefer specific models per task) on purpose; routing recommendations remain advisory display only, as before.

### Tests

- Added `gettingStartedPreference.test.ts` (completion/mode/device persistence, schema-version guard, corrupted-JSON guard, reset).
- Added `catalog.test.ts` (`newChatTaskOptions` excludes `document_analysis` and otherwise mirrors the shared catalog; `resolveConversationTask` defaults missing/invalid values to `"chat"`).
- Extended `accessibilityTokens.test.ts` with rail-token-forcing and selected-state-not-color-alone assertions, and added `chatShellLayout.test.ts` asserting the desktop `.app-shell`/`.chat-shell`/`.chat-main__*` CSS structure (viewport-owned root shell, remaining-height chat shell, `min-height: 0` on nested flex regions, independent `overflow-y: auto` scroll regions, anchored composer, route-scoped footer hiding).
- Extended `conversation-store`'s and `conversation-export`'s test suites with `task` field round-tripping, missing-task migration defaults, and old-export-without-task backward compatibility.
- Updated `deviceRecommendation.test.ts` and `i18n.test.ts` for the retired `getRecommendedChatPath`/`home.useRecommended`/`onboarding.taskTitle` surface.

### Known limitations after Sprint 6.11

- Settings' performance-mode change always requires an explicit "Save" click rather than truly detecting an in-progress generation elsewhere (the runtime's lifecycle is tied to the mounted `/chat` page, which already tears down on navigation away — there is currently no cross-page/cross-tab "is generating" signal to check). The always-explicit-confirm flow satisfies the "never silently interrupt" requirement without that signal.
- The redesign is presentation/data-flow layer over already-tested logic; no component-rendering or browser E2E framework was added, consistent with prior sprints. `NewChatTaskDialog`'s focus-trap/keyboard behavior is verified by source review and manual browser testing, not an automated DOM test, since the project still has no such test layer.
- No further v0.6.6-alpha work (if any) has been scoped yet; this sprint is explicitly "part 1."

### Planned work (not implemented yet)

- v0.7: use the refined device tier/`formFactor` in `model-router` to prefer specific models per task/device, as already described in `docs/roadmap.md` — intentionally out of scope for this sprint.
- Any further v0.6.6-alpha parts, if the mission is extended.

## Sprint 6.12 - v0.6.6-alpha part 2: persistent runtime ownership

### Built

- Moved WebLLM runtime ownership out of `apps/web/app/chat/page.tsx` and into `apps/web/app/_runtime/AppRuntimeProvider.tsx`, mounted from the root application layout above normal route boundaries. Entering `/chat` still triggers the first model load, but once the worker/runtime exists it survives internal navigation to Settings, Debug, Home, and back.
- Added `apps/web/app/_runtime/persistentRuntimeLifecycle.ts`, a small lifecycle controller around the existing `terminateWorkerAfter()` helper. It reuses one runtime instance while the provider stays mounted, treats route-view unmounts and hidden tabs as no-ops, and disposes only for app-root teardown, explicit reload, recovery, or a future performance/model replacement.
- Moved active generation orchestration into the provider. Each generation now has a `generationId`, conversation ID, and assistant message ID; chunks are applied only when those identifiers still match the active generation. This preserves streamed output while `/chat` is absent and prevents late chunks from an abandoned generation from overwriting newer conversation state.
- Kept conversation content persistence in `@free-ai-open/conversation-store`. The provider holds the current in-memory transcript UI state and persists the final assistant response only after the existing generation-persistence rules allow it; stopped, timed-out, failed, or unstable partial assistant output is still removed and not saved as a completed reply.
- Added `apps/web/app/_components/GlobalRuntimeStatus.tsx`, a restrained root-level status strip for useful cross-route runtime states: model loading, generating outside Chat, recovery, and errors. When a response continues outside `/chat`, the strip offers a translated "Return to conversation" action.
- Reworked `/settings` performance-mode save to call the runtime provider. While a generation, cancellation, or recovery is active, the save action is disabled and no preference write occurs. All modes still use the same placeholder model, so a valid change persists the preference without replacing the runtime; the policy already has an explicit replacement path for the future model-selection integration.
- Kept browser tab visibility out of runtime disposal. A hidden/background tab may be throttled by the browser or mobile OS, but the app does not intentionally cancel generation or unload the model only because visibility changed.

### Privacy and architecture notes

- The previous disposal root cause was the chat route owning `runtimeRef`, `workerRef`, generation refs, and a runtime lifecycle effect whose cleanup called teardown when `/chat` unmounted. The new root provider owns those resources for the lifetime of the application shell instead.
- Provider state may include technical runtime state, current conversation/generation identifiers, model/backend metadata, and in-memory streamed UI text. It does not write prompts, responses, document content, or conversation messages to local technical logs, diagnostic reports, telemetry, server storage, Supabase, or any network path.
- No `fetch`, `sendBeacon`, Supabase, Google Drive, cloud sync, new server endpoint, server-side WebLLM path, or full v0.7 model-router behavior was added.
- Performance preference persistence remains local-only. Changing the saved preference does not erase conversations, and the current placeholder-model runtime is not replaced unless a future policy says the model/backend actually changed.

### Tests

- Added `runtimeLifecyclePolicy.test.ts` for disposal triggers, including explicit coverage that route-view unmount and hidden-tab visibility are not disposal reasons.
- Added `persistentRuntimeLifecycle.test.ts` for single-instance ownership, route unmount no-op, hidden-tab no-op, explicit reload worker termination, and application-root teardown cleanup.
- Added `persistentGenerationState.test.ts` for active generation matching, stale chunk rejection, conversation/generation identity checks, and removal of abandoned assistant placeholders.
- Added `performanceModeRuntimePolicy.test.ts` for active-generation blocking, the current no-replacement placeholder-model behavior, future replacement decisions, and no-op same-mode saves.

### Known limitations after Sprint 6.12

- The app still has no browser-level E2E/rendering framework. The new persistent runtime behavior is covered by unit-level lifecycle/policy tests plus manual release-checklist checks for Chat -> Settings -> Chat, Chat -> Debug -> Chat, background tab behavior, Stop/recovery, and safe performance-mode changes.
- Background execution is not guaranteed by FreeAI Open. Browsers and mobile operating systems may throttle or suspend background tabs, so generation can slow or pause even though the app does not intentionally unload the model.
- The v0.7 router/model replacement path remains future work; this branch still runs the same placeholder WebLLM model for every performance mode and task recommendation.

## Sprint 6.13 - v0.7.0-alpha Phase 0: adaptive router contracts

### Built

- Defined the "Adaptive Model Router v1" contracts in `@free-ai-open/types`: `StaticCapabilityProfile` (static device/GPU capability), `LocalBenchmarkResult` (short local microbenchmark outcome, with an `expiresAt`), `ModelPerformanceObservation` (a single observed model load/generation outcome), and `CapabilityConfidence` (shared low/medium/high trust level). At the Phase 0 point in time, all four were additive, unwired types.
- Added `RouterInput`/`RouterDecision` to `@free-ai-open/model-router` (`adaptiveRouterContracts.ts`), and `ModelRegistryRecord` (plus `ModelStatus`, `LanguageSupport`, `Suitability`, `Estimate`, `ContextPreset`) to `@free-ai-open/model-registry` (`schema-v2.ts`), matching `14_MODEL_REGISTRY_SCHEMA.md`. Both coexist with, and leave completely unchanged, the active v0.6 router (`ModelRouterInput`/`ModelRouterResult`/`selectRecommendedModel()`) and registry (`ModelRecord`/`sampleModels`) that `AppRuntimeProvider` still uses today.
- Chose package boundaries for the new contracts by centralizing them in `@free-ai-open/types` — a zero-workspace-dependency leaf every other v0.7-relevant package (`device-profiler`, `model-registry`, `model-router`) already depends on or can depend on without new edges. This avoids `model-router` (meant to stay pure eligibility/scoring/fallback logic) needing a dependency on the much heavier `ai-runtime` (which pulls in `@mlc-ai/web-llm`) just to reference `ModelPerformanceObservation`. `RouterInput`/`RouterDecision` and `ModelRegistryRecord` stay in their natural owning packages (`model-router`, `model-registry`) since nothing else needs to import them.
- Moved `FormFactor`/`ArchitectureClass` from `device-profiler` into `types` (re-exported from `device-profiler` for full backward compatibility) so `StaticCapabilityProfile` reuses the exact same coarse categories as the existing v0.6 `DeviceProfile` instead of a duplicate parallel definition.
- Added three schema-versioned local preference stores in `apps/web/app/_lib/`, matching the existing `gettingStartedPreference.ts` convention exactly (window-guarded, try/catch, pure migrate function returning null/empty on any mismatch): `capabilityProfileStore.ts`, `benchmarkResultStore.ts` (treats an expired result as absent via a caller-supplied clock for testability), and `modelObservationStore.ts` (capped at 200 entries, oldest dropped first, mirroring `conversation-store`'s own pruning). None are called from any production code path yet — Phase 4 ("Intégration au runtime persistant") wires real writers.
- Added `packageDependencyBoundaries.test.ts`, a workspace dependency-graph test that reads the real `package.json` files (the same source `pnpm -r` uses) and walks the graph rather than asserting a fixed edge list, so it keeps working as later v0.7 phases add real edges.

### Privacy and architecture notes

- `StaticCapabilityProfile` only ever exposes coarse GPU *classes* and bounded feature/limit maps, never a raw adapter string; a contract test documents that no field name in `gpu` contains "string" as a guard against a future edit accidentally adding one back.
- `LocalBenchmarkResult`/`ModelPerformanceObservation` carry only technical timings, status/outcome codes, and confidence — never prompt, response, or conversation content. Neither is transmitted anywhere; both stores are local-only, `fetch`/`sendBeacon`-free.
- This is explicitly Phase 0 of a ten-phase pipeline (see `docs/roadmap.md`): contracts and architecture only. The capability profiler, local benchmark, and adaptive router itself are not implemented, and no current routing/runtime behavior changed.

### Tests

- Added contract-shape tests for every new type (`StaticCapabilityProfile`, `LocalBenchmarkResult`, `ModelPerformanceObservation`, `RouterInput`, `RouterDecision`, `ModelRegistryRecord`), each including a "no prompt/response/conversation-shaped fields" assertion.
- Added full migration coverage for the three new stores (valid round-trip, wrong schema version, malformed/missing fields, corrupted JSON; benchmark-specific expiry) and the observation store's append/cap/prune behavior.
- Added a test proving the active v0.6 `selectRecommendedModel()` is untouched and does not accept the new `RouterInput` shape.
- Added the package-boundary dependency-graph test described above.

### Known limitations after Sprint 6.13

- At the Phase 0 point in time, no detector, benchmark, or router implementation existed yet — every new type and store was unwired. Later v0.7 phases pick this up.
- `ModelRegistryRecord` has no real records yet; `sampleModels` (the active v0.6 registry) is what routing actually uses today.

### Planned work (not implemented yet)

- Phase 1A: Capability Profiler v2 (real `StaticCapabilityProfile` detection; now documented in the next section).
- Phase 1B: Model Registry v2 (real `ModelRegistryRecord` entries, verified).
- Phase 2: Local Benchmark v1 (real `LocalBenchmarkResult` measurement).
- Phase 3: Adaptive Router Core (real `RouterInput` → `RouterDecision` scoring, per `15_ROUTER_SCORING_SPEC.md`).
- Phase 4: wiring the above into `AppRuntimeProvider` so real observations/capability/benchmark data replace today's placeholder-model routing.
- Phase 5: public router UI and advanced settings.

## Sprint 6.14 - v0.7.0-alpha Phase 1A: Capability Profiler v2

### Built

- Implemented real `StaticCapabilityProfile` detection in `@free-ai-open/device-profiler`, using browser-visible signals only: form factor, architecture class, browser/OS family, approximate memory bucket, logical-processor bucket, WebGPU/WASM availability, fallback-adapter status, coarse GPU vendor/architecture/description classes, allowlisted WebGPU feature classes, selected WebGPU limit buckets, and optional experimental memory heap buckets with low confidence.
- Added `capabilityClass` (`compatibility`, `light`, `balanced`, `performance`) alongside the existing technical `deviceTier` values. The existing v0.6 router still consumes the technical tier only; the adaptive router is not complete yet.
- Updated `buildDeviceProfile()` so the legacy `DeviceProfile` is derived from the new static capability profile and carries the product-facing `capabilityClass`.
- Wired app device detection through a small `detectAndStoreDeviceProfile()` helper so Home, onboarding, Settings, Debug, and the runtime provider persist only the normalized static profile locally.
- Updated `capabilityProfileStore` to schema version 2 with expiry handling, browser/OS re-detection checks, safe migration from schema version 1, and rejection of raw GPU identifier fields.
- Updated diagnostic reports to include only coarse static capability fields when available.

### Privacy and architecture notes

- Raw GPU adapter strings, raw device names, driver strings, raw user-agent strings, exact CPU model/frequency, exact VRAM, exact high-entropy WebGPU limits, and unique fingerprint hashes are not persisted, logged, exported, or sent anywhere.
- GPU adapter info may be read in memory to derive coarse classes such as `nvidia`, `apple`, `integrated`, or `software`, then discarded.
- `navigator.deviceMemory` is treated as approximate and bucketed; it is not described as free browser memory.
- Browser-reported memory heaps are optional, non-standard, low-confidence inputs and are stored only as coarse buckets. A large heap cannot by itself promote a device to the performance class.
- No `fetch`, `sendBeacon`, Supabase, Google Drive, cloud sync, new server endpoint, server-side WebLLM, benchmark workload, or full adaptive router was added.

### Tests

- Added/updated device-profiler tests for WebGPU absence, adapter request failure, missing adapter info, fallback/software adapters, high-memory mobile/tablet conservatism, high-memory desktop differentiation, iPadOS desktop-style tablet classification, normal macOS desktop classification, ARM/x86/unknown architecture fallback, feature allowlisting, selected-limit bucketing, optional memory heap bucketing, large experimental memory non-promotion, privacy-safe serialized profiles, and static profile construction.
- Added store tests for schema version 2 persistence, schema version 1 migration, expiry, re-detection policy, and raw GPU field rejection.
- Added diagnostic-report tests proving coarse capability profile fields are accepted while raw GPU strings are ignored.

### Known limitations after Phase 1A

- Static detection is still an estimate. It cannot know exact CPU model, CPU frequency, exact VRAM, or sustained local model performance.
- At the Phase 1A point in time, the local benchmark, Model Registry v2 data, adaptive router core, runtime model-selection integration, and router UI remained future v0.7 phases. Model Registry v2 is now documented in the next section.
- Current model loading behavior remains the same placeholder-model path; capability profiler v2 does not yet select a different model.

## Sprint 6.15 - v0.7.0-alpha Phase 1B: Model Registry v2

### Built

- Replaced the Phase 0 type-only registry contract with a strict Zod schema version 2 and whole-registry validation. Validation covers exact `TaskCategory` scores, ordered context presets, verification metadata, HTTPS sources, estimate confidence, unique internal/WebLLM IDs, known fallback targets, and fallback-cycle detection.
- Added five curated WebLLM `0.2.84` records: SmolLM2 360M Instruct for compatibility, Qwen3 0.6B for light multilingual use, Qwen3 1.7B for balanced multilingual use, Qwen2.5-Coder 1.5B Instruct for coding, and Qwen3 4B for capable desktops.
- Recorded exact WebLLM model IDs and model-library URLs, upstream sources, download/runtime-memory estimates with confidence, installed 4,096-token context presets, conservative language/task/form-factor/mode scores, known issues, ordered fallbacks, and Apache-2.0 license sources.
- Added automatic-eligibility helpers that expose only records with `status: "verified"` and complete verification metadata. No scoring or runtime router integration was added.
- Replaced the fixed 135M Phase 0 test default with the browser-verified `SmolLM2-360M-Instruct-q4f32_1-MLC` compatibility model. This remains one fixed default for all tasks and performance modes.
- Added public verification and attribution documentation. All five candidates loaded, completed synthetic English/French checks, confirmed Stop, reloaded in a new worker/runtime, and completed a post-recovery generation in one coarse Chromium/Windows desktop environment.

### Privacy and architecture notes

- Registry records are static public technical metadata. They contain no prompt, response, conversation, document, user identifier, credential, or local path, and registry production code performs no network call.
- `@mlc-ai/web-llm` is a test-only dependency of `model-registry`, used to compare records against the installed `prebuiltAppConfig`; WebLLM remains a client-only production dependency of `ai-runtime`.
- The browser smoke run used synthetic non-personal input. Public results contain only model IDs, coarse environment, status, timings, and approximate stream rates; generated text and raw hardware identifiers were not recorded.
- Model files are not redistributed by this repository. Browser downloads continue through the existing WebLLM runtime and documented upstream artifacts.

### Tests

- Added strict schema tests for versioning, complete task coverage, ordered contexts, verification requirements, bounded suitability/capability values, honest unknown estimates, unknown fields, HTTPS sources, and self/duplicate fallbacks.
- Added registry tests for deterministic records, unique IDs, exact WebLLM model/artifact/library/feature/memory agreement, automatic eligibility, conservative French/mobile suitability, missing fallback rejection, cycle rejection, and private-field exclusion.
- Added an ai-runtime test proving the fixed default exists in WebLLM's installed prebuilt configuration and requires no extra GPU feature.

### Known limitations after Phase 1B

- Verification covers one browser/device class, not the full supported-device matrix. Mobile Safari, Firefox, Android browsers, integrated GPUs, and fallback adapters still require release testing.
- French completion is basic smoke evidence only. Qwen3 entries are marked `usable`, never `strong`; the compact and coding-specific models remain `limited`.
- The active v0.6 recommendation UI still reads `sampleModels`. The local benchmark, adaptive router core, runtime decision integration, explicit download UX, and router UI remain future phases.
- Browser cache eviction, model-host availability, and model/library compatibility can change; WebLLM or artifact updates require re-verification.

## Sprint 6.16 - v0.7.0-alpha Phase 2: Local Benchmark v1

### Built

- Added `@free-ai-open/local-benchmark` with a deterministic bounded WebGPU compute workload, reduced mobile/tablet profile, warmup, repeated wall-clock samples, median scoring, output validation, timeout/cancellation handling, and unconditional GPU resource cleanup.
- Runs the workload in a dedicated browser Worker so it does not reuse or interfere with the persistent WebLLM runtime.
- Added strict schema/version/expiry/coarse-profile cache invalidation. Setup runs once when no valid cached result exists; Settings provides an explicit rerun action.
- Added technical-only benchmark lifecycle logs and allowlisted benchmark fields in `/debug` diagnostic exports while keeping `contentLogged: false`.

### Tests

- Added scoring, workload selection, median/stability/responsiveness, success, unsupported WebGPU, cancellation, timeout, invalid samples, device loss, deterministic output validation, and GPU cleanup coverage.
- Added browser-coordinator tests for cache reuse, forced replacement, and privacy-safe logs, plus strict store migration/profile invalidation and diagnostic privacy tests.

### Known limitations after Phase 2

- The v1 score uses wall-clock timing and is project-specific, not a portable hardware benchmark. Browser power-saving and scheduling can affect it.
- Backgrounding the page cancels the run rather than trusting a throttled result. GPU timestamp queries are not used in v1.
- The result does not choose or download a model. Adaptive scoring and real model performance observations remain later phases.

## Sprint 6.17 - v0.7.0-alpha Phase 3: Adaptive Router Core

### Built

- Implemented pure `routeAdaptiveModel()` orchestration without changing the active v0.6 application path.
- Split normalization, recent observation aggregation, hard eligibility, scoring, fallback construction, and orchestration into focused modules.
- Added strict registry validation, defensive technical-input normalization, 30-day observation expiry, repeated OOM/device-loss exclusion, cancellation-neutral observation handling, bounded cache influence, French/English/task/mode suitability, eligible manual selection, conservative token presets, stable reason/warning/rejection codes, and technical score breakdowns.
- Fallbacks follow validated registry metadata, skip ineligible intermediates, become progressively no heavier, avoid cycles, and stop after a bounded number of attempts.

### Tests

- Added a 29-scenario adaptive-router suite (46 model-router tests total) covering mobile/desktop parity, weak/strong devices, French writing, English coding, unknown/WASM/fallback-adapter environments, benchmark states, cache/download effects, recent and stale observations, cancellation neutrality, repeated OOM/device loss, manual selection, token presets, hard feature/limit/memory gates, unsupported capability schemas, fallback order, invalid registries, deterministic output, malformed runtime values, and private-field exclusion.

### Known limitations after Phase 3

- `AppRuntimeProvider` still uses the active v0.6 recommendation path and fixed compatibility WebLLM model. No adaptive decision is loaded or downloaded yet.
- `ai-runtime` does not yet record real `ModelPerformanceObservation` entries; the core can consume them once Phase 4 supplies them.
- Known fatal incompatibilities are gated only where Registry v2 has structured fields. Free-text `knownIssues` are documentation and are deliberately not parsed as executable policy.
- Reason codes are ready for translation, but no Phase 5 recommendation/manual-selection UI exists yet.

## Sprint 6.18 - v0.7.0-alpha Phase 4: Runtime integration

### Built

- Rewired `AppRuntimeProvider` to compute a `RouterDecision` via `routeAdaptiveModel()` before the first model load, instead of unconditionally loading the fixed compatibility default. Routing recomputes only at real routing moments (task/locale/performance-mode change, or the current model crossing a repeated-fatal-failure threshold) via a new `routingDecisionCache.ts` cache key — never before every message.
- Added `apps/web/app/_runtime/routingOrchestration.ts`: `buildRouterInputContext()` (gathers stored capability/benchmark/observations plus real per-model cache status into a `RouterInput`), `attemptModelLoadWithFallback()` (walks a decision's selected model then fallback chain, recording one load observation per attempt, stopping at the first success), and `buildLoadCandidatesFromDecision()`/`registryIdForWebllmModelId()` (bridge `RouterDecision`'s registry-ID space to `ai-runtime`'s WebLLM-model-ID space at every call site).
- Added `apps/web/app/_lib/modelSwitchPolicy.ts`: resolves a decision's selected model against what's currently loaded into noop / blocked (runtime busy — loading, generating, cancelling, recovering) / switch-now (cached or the pre-disclosed default) / needs-consent. Applies identically to the very first load (switching from "no model loaded") and to every later routing moment, so a first automatic pick that needs a fresh download never starts silently — the disclosed default loads immediately instead, and a consent prompt offers the upgrade.
- Added `apps/web/app/_components/ModelDownloadConsent.tsx`: a plain-language prompt (model name, approximate size, that it runs locally, that it may take time) shown before any non-default, non-cached download, wired into `/chat`.
- Added `apps/web/app/_lib/performanceObservationBuilder.ts`: classifies load/generation outcomes into `ModelPerformanceObservation`s from `ai-runtime`'s `RuntimeErrorCode`/`GenerationStopReason` (cancellation is never recorded as a model failure), plus `isModelRepeatedlyFailing()` used to trigger a prompt re-route.
- Added `@free-ai-open/ai-runtime`'s `isModelCached()` (thin wrapper over WebLLM's `hasModelInCache()`, defaulting to "not cached" on any failure) and an optional `maxOutputTokens` on `GenerateInput` that can only tighten, never raise, the existing alpha `GENERATION_SAFETY_LIMITS.maxTokens` cap. `sendMessage()` now passes `RouterDecision.recommendedMaxOutputTokens` through and measures real `firstTokenTimeMs`/`generationDurationMs` locally to build generation observations.
- Extended `runtimeLifecyclePolicy.ts` with a `model_replacement` disposal trigger, reusing the existing safe dispose-then-recreate worker-teardown sequence for model switches.
- Extended `/debug` with an adaptive-router panel (selected model, confidence, translated reason/warning codes, fallback chain, rejected models with reasons, recommended context/output tokens, decision/registry version) and an observations summary (total, per-outcome, per-model), both additive next to the untouched v0.6 preview panel.
- Updated `/chat`'s model-status display for the new `RouterDecision` shape; moved the detailed reason/rejection breakdown to `/debug` to keep the normal chat surface simple, per the phase's own "keep normal chat simple" guidance — the chat screen now only surfaces the one case a chatting user needs to act on (no compatible model).

### Known limitations after Phase 4

- `promptTokensPerSecond`/`generationTokensPerSecond` are not populated: `ai-runtime`'s `generate()` does not currently surface real token counts from WebLLM, and the observation builder deliberately does not approximate them from character counts to avoid feeding noisy signal into future routing scores.
- The `device_lost` observation outcome is defined but currently unreachable in practice: `ai-runtime`'s error classifier maps WebLLM's `DeviceLostError` to `out_of_memory`, not a distinct code.
- `recommendedContextTokens` influences model/preset selection (Phase 3's `selectPreset()`) but is not separately enforced as a per-call truncation limit; the loaded model's own WebLLM config fixes its actual context capacity.
- Manual model override (`RouterInput.manualModelId`) stays wired through every function this phase but is always `undefined` from the app layer — Phase 5 owns the picker UI.
- Live end-to-end verification (an actual model download and generation) could not be completed in this session's sandboxed browser preview tool: WebGPU capability detection and the local benchmark both succeed there, and the adaptive routing decision renders correctly end-to-end on `/debug` (real capability data in, real translated reason/warning codes and fallback chain out), but the tab consistently crashes when WebLLM's `CreateWebWorkerMLCEngine` begins real GPU pipeline/shader compilation — before any model-weight download even starts, and identically regardless of which model is selected. `/settings` and `/debug` (neither of which loads a model) remain fully responsive throughout, and the crash is isolated to that one step, unchanged by this phase's code. This looks like a sandboxed/virtualized WebGPU compute limitation of that specific tool rather than an application defect, but it means this session's own verification stops at "the decision and every non-GPU code path are proven correct" rather than "a model was watched loading and replying." A real desktop Chromium/WebGPU browser should be used to complete the manual smoke tests in `docs/RELEASE_CHECKLIST.md`'s new Phase 4 section before this phase is considered fully verified.

### Tests

- Added unit coverage for every new pure module: `routingDecisionCache.ts`, `modelSwitchPolicy.ts`, `performanceObservationBuilder.ts` (including outcome classification and a privacy-shape allowlist check), `modelDownloadDisclosure.ts`, `adaptiveRouteExplanation.ts` (asserts every reason/warning/rejection code resolves to a non-empty EN/FR string), `observationsSummary.ts`, and `routingOrchestration.ts` (`buildRouterInputContext`, `attemptModelLoadWithFallback` including the registry-ID-vs-WebLLM-ID distinction and candidate deduplication, `buildLoadCandidatesFromDecision`, `registryIdForWebllmModelId`).
- Extended `runtimeLifecyclePolicy.test.ts` for the new `model_replacement` trigger.
- Full monorepo `pnpm -r typecheck`, `pnpm -r test` (229 web app tests, all packages green), `pnpm lint`, and `pnpm build` all pass.

## Sprint 6.19 - v0.7.0-alpha Phase 5: Router UI

### Built

- Added `apps/web/app/_lib/manualModelPreference.ts`, a schema-versioned local preference (`{mode: "automatic" | "manual", manualModelId}`) mirroring `gettingStartedPreference.ts`, loaded into `AppRuntimeProvider` on mount and threaded through every `evaluateRouting()` call as `RouterInput.manualModelId`.
- Added `apps/web/app/_components/ManualModelPicker.tsx`, used from `/settings`: an "Automatic — recommended" option plus one card per registry model (friendly name, approximate size, live cache status, a technical-details disclosure with exact WebLLM ID/language suitability/recommended tasks/device suitability). A card is disabled — never hidden — when `apps/web/app/_lib/manualModelEligibility.ts`'s `resolveManualModelEligibility()` finds the model in the latest `RouterDecision.rejectedModels`, showing the router's own rejection reasons.
- Added `apps/web/app/_lib/friendlyRouteExplanation.ts`: reduces a decision's reason codes to exactly one plain-language sentence via a fixed priority order (fallback story first, then language match, task fit, speed/device-fit, cached), shown on `/chat` next to the status pill.
- Added `apps/web/app/_lib/modelStatusLabel.ts`: layers the mission's named states (Choosing a local model, Download required, Preparing the local model, Trying a lighter model, Model unavailable) in front of the existing `runtimeStatusPlain` labels, never shown once a model is actually usable. `attemptModelLoadWithFallback()` gained an optional `onAttempt(candidate, attemptIndex)` callback so the provider can flip an `isFallbackRetry` flag once a fallback attempt begins.
- Added local "performance history" controls in `/settings`: "Clear performance history" (`clearObservations()`, wraps the existing Phase 0 `clearStoredModelPerformanceObservations()`) and a "Clear result"/"last checked" date on the local benchmark panel.
- Added `apps/web/app/_lib/chatEmptyState.ts`: distinguishes WebGPU-unavailable (every rejected model blocked specifically by `backend_unavailable`) and manual-model-no-longer-eligible from the generic no-compatible-model case, each with plain-language chat copy. Added `useOnlineStatus()` for an offline-specific line on the existing model-unavailable error banner.
- Added mobile-data awareness to `ModelDownloadConsent`: `PendingModelSwitch` gained `isMobileFormFactor`, and `apps/web/app/_lib/modelDownloadDisclosure.ts`'s `isLargeMobileDownload()` (≥500 MB) drives an extra warning line on a mobile-reported device.
- Extended `/debug`'s adaptive-router panel with per-model cache status (inline on the selected-model and fallback-chain rows) and the real automatic/manual mode, both computed from the debug page's own independent preview `RouterInput` (consistent with how it has never read live `AppRuntimeProvider` state).
- Fixed an invalid-markup bug found while building the manual picker: an earlier draft nested a `<details>` technical-info disclosure inside the model-selection `<button>`, which HTML forbids (interactive content cannot nest inside interactive content). The selectable button and the details disclosure are now siblings.
- Fixed a real, previously undetected bug found by live browser testing: `packages/model-registry/src/registry-v2.ts`'s five `descriptionKey` values (`modelRegistry.smollm2Compact.description` etc., added by an earlier, concurrent Phase 1B session) had never been added to `en.ts`/`fr.ts` — `t()` throws on an unresolved key outside production, so `/settings` crashed the instant `ManualModelPicker` rendered a description for any model. This went uncaught through Phase 4 because nothing in that phase's code path ever actually called `t(record.descriptionKey)` in a live render (`ModelDownloadConsent` only mounts once `pendingModelSwitch` is set, which this session's sandboxed-browser WebGPU limitation never reached), and the i18n lockstep test only checks that EN and FR have the *same* key set as each other — both were equally missing `modelRegistry.*`, so it passed despite the underlying data/dictionary mismatch. Added the missing `modelRegistry` namespace (five real descriptions, EN/FR) to close the gap; confirmed fixed via live `/settings` rendering, not just the type checker (`descriptionKey` is a plain `string` at the registry-package boundary, so a dangling key reference cannot fail `tsc`).
- Added `ModelDownloadConsent` rendering to `/settings` itself (previously only rendered on `/chat`): picking a manual model that needs a fresh download now shows the consent prompt wherever the pick was made, not only after navigating to Chat. Found via the same live-testing pass — selecting a model from Settings produced no visible feedback beyond the persisted preference until this fix.

### Known limitations after Phase 5

- `promptTokensPerSecond`/`generationTokensPerSecond` and the `device_lost` observation outcome remain the same Phase 4 gaps (`ai-runtime` doesn't surface real token counts or a distinct device-loss error code yet).
- The manual model picker fails open (shows every model as selectable) when no `RouterDecision` has been computed yet, rather than blocking selection outright — the router's own hard gates still apply the moment a pick is actually routed, so this can never let an unsafe load through, only briefly under-disables the UI before the first decision lands.
- Live end-to-end verification of the manual picker's actual model-switching behavior (watching a real download/load happen after a manual pick) carries the same sandboxed-browser-preview limitation noted in Sprint 6.18 — the decision, eligibility, and consent logic are proven correct through unit tests and the real `/debug` preview, but a real desktop Chromium/WebGPU browser should be used to complete the new Phase 5 manual checklist in `docs/RELEASE_CHECKLIST.md`.

### Tests

- Added unit coverage for every new pure module: `manualModelPreference.ts`, `friendlyRouteExplanation.ts`, `modelStatusLabel.ts`, `manualModelEligibility.ts`, `chatEmptyState.ts`, and the `isLargeMobileDownload()`/`onAttempt` additions to `modelDownloadDisclosure.ts`/`routingOrchestration.ts`.
- Full monorepo `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint`, and `pnpm build` all pass; i18n lockstep test covers every new EN/FR string.

## Sprint 6.20 - v0.7.0-alpha Phase 6: global review corrections

### Corrected

- Rebuilt persisted capability profiles, model observations, direct router capability input, and diagnostic capability fields from strict technical allowlists. Unknown GPU classes/limit keys, raw-like fields, private text placed in a nominally technical field, malformed timestamps, future profiles, and unexpected observation fields are rejected or removed instead of being trusted through a TypeScript cast.
- Centralized capability category constants and the coarse capability-profile key in `@free-ai-open/types`, so profiler persistence, benchmark matching, router normalization, and diagnostic sanitation use the same categories. A benchmark now applies only to the exact current coarse profile and valid date interval.
- Separated load-attempt and generation denominators in adaptive observation aggregation. Load success no longer inflates generation completion, user cancellation remains neutral, and repeated stalls join repeated OOM/device-loss outcomes as a hard reliability signal.
- Applied `RouterDecision.recommendedContextTokens` to WebLLM engine creation with a verified registry-preset cap. The existing output-token value still only tightens the global generation-safety cap.
- Restricted fallback load candidates to models that are cached, explicitly approved, or disclosed during first-run setup. Declined and failed upgrades are remembered for the session, preventing repeated consent/failure loops; late routing/model-switch completions are isolated with epochs.
- Extracted adaptive routing, consent, model switching, recovery, and runtime initialization from `AppRuntimeProvider` into the focused `useAdaptiveRuntimeRouting` hook. The provider remains responsible for conversation and generation coordination, avoiding a single oversized orchestration component.
- Re-evaluate routing after real generation observations and after Settings actions that change local evidence (device re-check, benchmark rerun/clear, observation clear). The routing cache includes a deterministic technical observation revision.
- Aligned `/chat`, `/settings`, and `/debug` with the persistent provider as one source of truth. They distinguish the live loaded model from a recommendation, localize friendly Registry v2 names, keep manual choices disabled until capability routing completes, and export current runtime/recommended/loaded diagnostic values rather than reconstructing a legacy preview from stale logs.
- Added a benchmark skip path and an honest first-run disclosure for the compact compatibility model's local download/cache. Download consent uses truthful inline-region semantics and accessible text contrast; technical IDs wrap instead of causing narrow-screen overflow.
- Replaced the broken SmolLM2 repository `LICENSE` URL with the upstream model card's explicit Apache-2.0 license section.

### Tests

- Added regression tests for strict capability/router/diagnostic/observation sanitation, invalid/future dates, benchmark-profile mismatch, correct load-versus-generation aggregation, repeated stalls, numeric GPU-limit gates, context-window forwarding, disclosed fallback filtering, session decline policy, routing-cache observation revisions, conservative pending manual eligibility, localized model names, status priority, and live values in diagnostic exports.

### Remaining limits

- Browser APIs still do not expose exact VRAM consistently; capability and memory fit remain conservative estimates.
- Real token-rate observations remain unset until `ai-runtime` exposes tokenizer-backed counts. WebGPU device loss is still mapped through the current out-of-memory error classification.
- Registry v2 remains a small five-model alpha catalog. Full desktop/mobile acceptance testing, including real model downloads and repeated fallback/recovery cycles, remains required before tagging.

## Cross-cutting remaining work

- Re-verify and expand Model Registry v2 only when an exact artifact, source, license, and supported-device case can be substantiated.
- Add broader browser/E2E tests for chat, Stop, Reload model, persisted conversation history, and debug export.
- Keep Supabase usage limited to future technical metadata or optional features until schema and privacy boundaries are explicitly designed.
- Keep Google Drive sync future-only and client-side encrypted if implemented later.
- Document any new third-party service before integration.

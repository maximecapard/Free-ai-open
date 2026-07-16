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

[Unreleased]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.3-alpha...HEAD
[0.6.3-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.2-alpha...v0.6.3-alpha
[0.6.2-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.6.1-alpha...v0.6.2-alpha
[0.5.0-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.4.1-alpha...v0.5.0-alpha
[0.4.1-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.4.0-alpha...v0.4.1-alpha
[0.4.0-alpha]: https://github.com/maximecapard/Free-ai-open/releases/tag/v0.4.0-alpha

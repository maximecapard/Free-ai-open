# Changelog

All notable changes to FreeAI Open are documented here.

This project follows a format close to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are alpha milestones while the MVP is still under active development.

## [Unreleased]

### Added

- Added `CONTRIBUTING.md`, `SECURITY.md`, `docs/PROJECT_OVERVIEW.md`, and a "Privacy/security report" issue template for public repository readiness.
- Expanded the pull request template with changes-made, local storage impact, and diagnostic/logging impact sections, plus an explicit no-content-logged/no-new-network-path/no-cloud-sync checklist.
- Clarified `docs/privacy.md` to distinguish currently implemented user controls (erase conversations, erase/export local logs and diagnostic report) from planned ones (telemetry toggle, model cache erase, conversation export/import, encrypted Drive sync).
- Added a performance-depends-on-browser/device/model note and links to the new docs to `README.md`.
- Rewrote `README.md` as a project-facing alpha overview with implemented features, explicit non-implemented scope, privacy model, architecture summary, setup commands, and documentation links.
- Added Sprint 5.1 robustness tests for local conversation persistence: real IndexedDB coverage via `fake-indexeddb`, no-IndexedDB memory fallback, active conversation ID pointer storage, local-log rejection of conversation content, and diagnostic-report privacy exclusion for conversation-shaped input.
- Added a release checklist TODO for future browser-level coverage of persisted chat refresh and delete confirmation flows instead of adding a heavy E2E framework prematurely.

### Planned

- The model catalog is intentionally small and still uses early compatibility metadata.
- Supabase-backed persistence is not started.
- Google Drive sync is not started.
- The browser runtime still targets a small WebLLM test model before broader model support.
- Import/export UX for local conversations is not added.
- End-to-end browser coverage for persisted chat sessions and debug workflows is still limited.

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

[Unreleased]: https://github.com/maximecapard/Free-ai-open/compare/v0.5.0-alpha...HEAD
[0.5.0-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.4.1-alpha...v0.5.0-alpha
[0.4.1-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.4.0-alpha...v0.4.1-alpha
[0.4.0-alpha]: https://github.com/maximecapard/Free-ai-open/releases/tag/v0.4.0-alpha

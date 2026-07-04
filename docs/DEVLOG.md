# Development Log

This log summarizes the implementation history of FreeAI Open. It records what has been built, the privacy boundaries that were protected, and what remains incomplete.

## Current status

FreeAI Open is an alpha-stage, local-first browser AI assistant. The current codebase includes:

- a Next.js app shell and basic chat UI;
- local WebLLM runtime integration through a Web Worker;
- device profiling and task-based model routing;
- privacy redaction, structured technical logging, and telemetry schema validation;
- local technical logs in IndexedDB;
- a debug dashboard and privacy-safe diagnostic report export;
- a local-only conversation-store package wired into the `/chat` UI through a history sidebar (create, resume, rename, delete).

## Sprint 1 - App shell, model registry, privacy redactor, telemetry schema

### Built

- Initial Next.js app shell and project structure.
- Typed model registry package with validation.
- Privacy redactor package for removing forbidden content-bearing fields.
- Strict telemetry schema package with technical field allowlists.

### Remaining limits after Sprint 1

- No browser runtime yet.
- No device profiling or routing integration in the user flow.
- No local logs or diagnostic report export.

## Sprint 2 - Device profiler, model router, onboarding

### Built

- Device profiler package with safe browser-only WebGPU detection and fallback behavior.
- Device tier model from `cpu_only` through `desktop_power`.
- Model router package using the model registry and `TaskCategory`.
- Onboarding flow for task selection, device checks, and performance mode.

### Remaining limits after Sprint 2

- Recommendations were not yet tied to a complete runtime experience.
- Browser-specific behavior still needed runtime integration testing.

## Sprint 3 - WebLLM runtime

### Built

- Initial WebLLM runtime integration through a browser Web Worker.
- Runtime state management for model loading, ready, generating, cancelling, and error states.
- Simple chat page that sends prompts only to the local browser runtime.
- Runtime error classification and Stop generation recovery.

### Remaining limits after Sprint 3

- The model catalog remained intentionally small.
- Full persisted conversations were still missing.

## Sprint 4 - Local logs, debug dashboard, diagnostic report

### Built

- `@free-ai-open/local-logs` package for local technical logs in IndexedDB.
- Safe local-log behavior when IndexedDB is unavailable or storage operations fail.
- `@free-ai-open/diagnostic-report` package for privacy-safe diagnostic report generation.
- `/debug` dashboard for local technical diagnostics.

### Privacy notes

- Local logs and diagnostic reports are local-only.
- Diagnostic reports are rebuilt from technical allowlists and force `contentLogged: false`.
- No server endpoint, Supabase integration, Google Drive integration, or fetch/sendBeacon path was added for logs or reports.

## Sprint 4.1 - Stop generation runtime recovery

### Built

- Added `cancelling` runtime state.
- Added `inference.cancel.requested`, `cancel_timeout`, and `generation_stalled` recovery paths.
- Added `generationEpoch` protection so late confirmations cannot overwrite newer state.
- Added worker teardown that terminates a stuck runtime worker without requiring page refresh.

### Remaining limits after Sprint 4.1

- Worker teardown is covered by unit tests, but not yet by browser-level recovery tests.
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

- New chat / conversation switching is disabled while a reply is generating or cancelling, to avoid mixing streamed tokens across conversations.
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
- Reviewed `README.md`, `CHANGELOG.md`, `docs/privacy.md`, `docs/security.md`, and `docs/architecture.md` for consistency with the actual Sprint 5 implementation.
- Cut the `v0.5.0-alpha` changelog entry.
- Added `docs/RELEASE_CHECKLIST.md`.
- Added a short near-term section to `docs/roadmap.md`.
- Added an explicit documentation-sync rule to `AGENTS.md` and `CLAUDE.md`.
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

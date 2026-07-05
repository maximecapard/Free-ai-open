# Development Log

This log summarizes the implementation history of FreeAI Open. It is intentionally factual: it records what has been built, what privacy boundaries were protected, and what remains incomplete.

## Current status

FreeAI Open is an alpha-stage, local-first browser AI assistant. The current codebase includes:

- a Next.js app shell and basic chat UI;
- local WebLLM runtime integration through a Web Worker;
- device profiling and task-based model routing;
- privacy redaction, structured technical logging, and telemetry schema validation;
- local technical logs in IndexedDB;
- a debug dashboard and privacy-safe diagnostic report export;
- a local-only conversation-store package wired into the `/chat` UI through a history sidebar for create, resume, rename, and delete.

The product is not yet a complete MVP. Broad model support, encrypted sync, import/export UX, production-ready telemetry persistence, and browser end-to-end coverage remain future work.

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

## Cross-cutting remaining work

- Expand and validate the model registry before adding more model records.
- Add broader browser/E2E tests for chat, Stop, Reload model, persisted conversation history, and debug export.
- Add conversation import/export UX if it remains in scope.
- Keep Supabase usage limited to future technical metadata or optional features until schema and privacy boundaries are explicitly designed.
- Keep Google Drive sync future-only and client-side encrypted if implemented later.
- Document any new third-party service before integration.

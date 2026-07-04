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
- a local-only conversation-store package, not yet wired into the chat UI.

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

## Conversation store work

### Built

- Added `@free-ai-open/conversation-store`.
- Added local IndexedDB persistence with memory fallback.
- Added schema versioning, `createdAt`, and `updatedAt`.
- Added limits for total conversations, messages per conversation, message size, and title size.
- Added create/list/get/add message/rename/delete/clear/recent APIs.

### Privacy notes

- Conversation content stays in the browser.
- The package does not call network APIs, server endpoints, Supabase, Google Drive, telemetry, or local logs.
- Diagnostic report tests ensure conversation content fields are not exported.

### Remaining limits

- The chat UI is not yet wired to the conversation store.
- There is no encrypted sync, import/export UI, or multi-device persistence.
- IndexedDB schema migration is intentionally simple and currently starts at schema version 1.

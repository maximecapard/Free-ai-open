# Development Log

This log summarizes the implementation history of FreeAI Open. It is intentionally factual: it records what has been built, what privacy boundaries were protected, and what remains incomplete.

## Current status

FreeAI Open is an alpha-stage, local-first browser AI assistant. The current codebase includes:

- a Next.js app shell and basic chat UI;
- local WebLLM runtime integration through a Web Worker;
- device profiling and task-based model routing;
- privacy redaction, structured technical logging, and telemetry schema validation;
- local technical logs in IndexedDB;
- a debug dashboard and privacy-safe diagnostic report export.

The product is not yet a complete MVP. Local conversation persistence, broad model support, encrypted sync, and production-ready telemetry persistence remain future work.

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

## Cross-cutting remaining work

- Implement local conversation persistence without sending content to the server.
- Expand and validate the model registry before adding more model records.
- Add broader browser/E2E tests for chat, Stop, Reload model, and debug export.
- Keep Supabase usage limited to future technical metadata or optional features until schema and privacy boundaries are explicitly designed.
- Keep Google Drive sync future-only and client-side encrypted if implemented later.
- Document any new third-party service before integration.

# Changelog

All notable changes to FreeAI Open are documented here.

This project follows a format close to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are alpha milestones while the MVP is still under active development.

## [Unreleased]

### Planned

- Local conversation persistence is still incomplete.
- The model catalog is intentionally small and still uses early compatibility metadata.
- Supabase-backed persistence is not started.
- Google Drive sync is not started.
- The browser runtime still targets a small WebLLM test model before broader model support.
- End-to-end browser coverage for the full chat and debug workflows is still limited.

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

[Unreleased]: https://github.com/maximecapard/Free-ai-open/compare/v0.4.1-alpha...HEAD
[0.4.1-alpha]: https://github.com/maximecapard/Free-ai-open/compare/v0.4.0-alpha...v0.4.1-alpha
[0.4.0-alpha]: https://github.com/maximecapard/Free-ai-open/releases/tag/v0.4.0-alpha

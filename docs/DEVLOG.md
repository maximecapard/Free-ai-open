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
- a local-only conversation-store package wired into the `/chat` UI through a history sidebar for create, resume, rename, and delete;
- local conversation export/import, wired into the `/chat` history sidebar (export current, export all, import with a result summary);
- English/French UI translation with browser-language detection and a visible toggle, and light/dark/system theme support with a visible toggle, both persisted locally.

The product is not yet a complete MVP. Broad model support, encrypted sync, production-ready telemetry persistence, browser end-to-end coverage, and full UI translation coverage remain future work.

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

## Cross-cutting remaining work

- Expand and validate the model registry before adding more model records.
- Add broader browser/E2E tests for chat, Stop, Reload model, persisted conversation history, and debug export.
- Keep Supabase usage limited to future technical metadata or optional features until schema and privacy boundaries are explicitly designed.
- Keep Google Drive sync future-only and client-side encrypted if implemented later.
- Document any new third-party service before integration.

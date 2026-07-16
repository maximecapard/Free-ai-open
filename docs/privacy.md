# Privacy policy design

## Main promise

FreeAI Open does not see your conversations.

Your prompts, AI responses, uploaded documents, and chat history stay on your device by default.

## What never leaves the browser by default

- prompts
- model responses
- documents
- extracted document text
- conversation history
- locally stored conversations
- local files
- private notes
- API keys

## What may be sent

Only redacted technical telemetry:

- error codes
- selected model ID
- backend
- performance mode
- task category
- app version
- approximate browser/OS family
- device tier
- performance metrics

## User controls

Users should be able to:

- disable telemetry;
- view the last data sent;
- export debug logs;
- erase local logs;
- erase local conversations;
- erase model cache;
- export/import local conversations;
- enable encrypted Drive sync later.

Implemented today: erase local conversations (delete from the `/chat` history sidebar), erase/view/export local logs and the diagnostic report (`/debug`), and local JSON conversation export/import from the `/chat` history sidebar. A telemetry on/off toggle, erasing the model cache, encrypted export, and encrypted Drive sync are not implemented yet — see [`docs/roadmap.md`](roadmap.md).

## Local conversations

Conversation persistence is local-only. Stored conversations may contain user prompts and assistant responses, so they must not be sent to telemetry, diagnostic reports, Supabase, Google Drive, or any server endpoint by default.

The conversation store uses IndexedDB when available and an in-memory fallback when IndexedDB is unavailable. The fallback is temporary and disappears when the page session ends.

Sprint 5.1 adds unit coverage for the IndexedDB store, no-IndexedDB memory fallback, active conversation ID pointer, local-log rejection of conversation content fields, diagnostic-report exclusion of conversation-shaped input, and absence of `fetch`/`sendBeacon` paths in the conversation store.

## Local conversation export/import

The core export/import format is a local JSON file with `format: "freeai-open-conversations"` and `version: 1`. Export files may contain prompts and model responses because their purpose is user-controlled local backup. They must not be sent to telemetry, local technical logs, diagnostic reports, Supabase, Google Drive, or any server endpoint by default.

Imports are validated strictly before use. Imported conversations receive new local conversation IDs by default so an import cannot silently overwrite an existing conversation. The export format is not encrypted; encrypted backup is future work.

The `/chat` history sidebar exposes this as "Export current", "Export all", and "Import" actions. Export downloads a JSON file directly in the browser (no server involved); import reads the file locally, validates it, and shows a summary of what was imported or skipped. The UI displays a persistent reminder that exported files contain conversation text, are not encrypted, and are the user's responsibility once downloaded.

## Generation safety

Generation safety is an alpha safeguard against unstable local model output. If a reply is cancelled, stalls, times out, fails, or is detected as degenerate output, FreeAI Open removes the partial assistant response from the chat UI and does not save it as a completed assistant message. Technical events, local logs, and diagnostic reports are limited to metadata such as event names, statuses, error codes, lengths where applicable, and timing metrics; they must not include the generated text itself.

During normal streaming, the chat UI may briefly buffer generated text in memory before rendering it to reduce React update pressure. This buffer is not local technical logging, telemetry, diagnostic-report data, IndexedDB persistence, or server data. It is discarded after the generation path flushes or ends.

## Language and theme preferences

The UI language (English/French) and theme (system/light/dark) are stored locally as small preference values, never sent to a server, and never combined with conversation content. Language defaults to the browser's language on first visit; theme defaults to the operating system's preference. Both can be changed anytime from the header and are remembered on this device.

When a chat generation starts, FreeAI Open adds a hidden runtime-only system instruction so the local model should answer in the selected UI language by default. This instruction is best effort because model capabilities vary. It is not stored in conversation history, not shown in the chat UI, not exported with local conversation backups, not included in diagnostic reports, and not written to local technical logs.

Changing the UI language affects the next generation; it does not rewrite existing conversation messages.

## Device capability profiling

FreeAI Open estimates a coarse device capability tier (`0`–`4`) locally to pick a suitable model, and to show device information in onboarding and `/debug`. This check runs entirely in the browser and is never sent to a server.

The profile only ever contains coarse, bounded categories: a form factor (`mobile`/`tablet`/`desktop`/`unknown`), an architecture class (`arm`/`x86`/`unknown`), a memory class and a CPU-concurrency class (each `low`/`medium`/`high`/`unknown`), WebGPU availability, and the preferred backend. The iPadOS desktop-style heuristic uses local browser signals only to choose the coarse `tablet` bucket when a `Macintosh`/`Mac OS` user agent is paired with multitouch support; raw user-agent and touch-point values are not exposed in the profile, logs, diagnostics, telemetry, or any server request. None of these profile fields are raw sensor values, a raw user-agent string, or a combination specific enough to uniquely identify a device — they cannot be used as a device fingerprint. An optional, locally-supplied measured-performance value (tokens per second, load time, first-token time, recent failure count) can adjust the tier, but nothing populates it with real data yet, and it is never sent anywhere.

## Cancellation recovery

After Stop, the interrupted WebLLM worker is treated as potentially unsafe. FreeAI Open discards the partial assistant response, moves through a local `recovering` state, terminates the old worker, and reloads the cached model in a new runtime before enabling the next send action. Recovery events are local technical metadata only (`runtime.recovery.started`, `runtime.recovery.completed`, `runtime.recovery.failed`) and must not contain prompts, model replies, conversations, documents, or hidden language instructions.

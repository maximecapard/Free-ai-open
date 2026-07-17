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

## First-run setup preference

Whether the first-run "Getting Started" flow has been completed, the performance mode the user confirmed, and a coarse device snapshot (tier, WebGPU availability, form factor — the same fields already covered under "Device capability profiling" below) used only to explain that choice later are stored as a single local preference value, never sent to a server. Getting Started is shown automatically only when this value shows it hasn't been completed, and is shown again only after the user resets it from Settings or clears the browser's site data for this app.

## Local conversations

Conversation persistence is local-only. Stored conversations may contain user prompts and assistant responses, so they must not be sent to telemetry, diagnostic reports, Supabase, Google Drive, or any server endpoint by default. Each conversation may also carry a short usage/purpose label (its "task", e.g. "coding" or "writing") chosen when the conversation was created — never prompt or response content, and included in local exports the same way the conversation title already is.

The conversation store uses IndexedDB when available and an in-memory fallback when IndexedDB is unavailable. The fallback is temporary and disappears when the page session ends.

Sprint 5.1 adds unit coverage for the IndexedDB store, no-IndexedDB memory fallback, active conversation ID pointer, local-log rejection of conversation content fields, diagnostic-report exclusion of conversation-shaped input, and absence of `fetch`/`sendBeacon` paths in the conversation store.

## Local conversation export/import

The core export/import format is a local JSON file with `format: "freeai-open-conversations"` and `version: 1`. Export files may contain prompts and model responses because their purpose is user-controlled local backup. They must not be sent to telemetry, local technical logs, diagnostic reports, Supabase, Google Drive, or any server endpoint by default. Each conversation's optional `task` label is preserved on export/import the same way its title is; older export files without a `task` field remain fully valid to import.

Imports are validated strictly before use. Imported conversations receive new local conversation IDs by default so an import cannot silently overwrite an existing conversation. The export format is not encrypted; encrypted backup is future work.

The `/chat` history sidebar exposes this as "Export current", "Export all", and "Import" actions. Export downloads a JSON file directly in the browser (no server involved); import reads the file locally, validates it, and shows a summary of what was imported or skipped. The UI displays a persistent reminder that exported files contain conversation text, are not encrypted, and are the user's responsibility once downloaded.

## Generation safety

Generation safety is an alpha safeguard against unstable local model output. If a reply is cancelled, stalls, times out, fails, or is detected as degenerate output, FreeAI Open removes the partial assistant response from the chat UI and does not save it as a completed assistant message. Technical events, local logs, and diagnostic reports are limited to metadata such as event names, statuses, error codes, lengths where applicable, and timing metrics; they must not include the generated text itself.

During normal streaming, the chat UI may briefly buffer generated text in memory before rendering it to reduce React update pressure. This buffer is not local technical logging, telemetry, diagnostic-report data, IndexedDB persistence, or server data. It is discarded after the generation path flushes or ends.

## Persistent runtime and navigation

The WebLLM runtime is owned by a root-level client provider so normal internal navigation does not unload the local model. Navigating from Chat to Settings or Debug and back keeps the same local worker/runtime when it is healthy, and an active generation can continue while the Chat route is temporarily unmounted.

The provider may keep technical runtime state, the current conversation ID, the current generation ID, model/backend metadata, and in-memory transcript UI state needed to keep streaming visible when the user returns to Chat. It must not write prompts, responses, conversation messages, uploaded document content, hidden language instructions, local file paths, API keys, or tokens into local technical logs, diagnostic reports, telemetry, server storage, Supabase, or any network path.

Conversation content remains local browser data. Completed messages are persisted through `@free-ai-open/conversation-store`; partial assistant output from a stopped, timed-out, failed, or unstable generation is still removed and not saved as a completed response.

FreeAI Open does not unload the model only because the browser tab becomes hidden. Background tabs may still be throttled or suspended by the browser or mobile operating system, so generation can slow or pause outside the app's control.

## Language and theme preferences

The UI language (English/French) and theme (system/light/dark) are stored locally as small preference values, never sent to a server, and never combined with conversation content. Language defaults to the browser's language on first visit; theme defaults to the operating system's preference. Both can be changed anytime from the header and are remembered on this device.

When a chat generation starts, FreeAI Open adds a hidden runtime-only system instruction so the local model should answer in the selected UI language by default. This instruction is best effort because model capabilities vary. It is not stored in conversation history, not shown in the chat UI, not exported with local conversation backups, not included in diagnostic reports, and not written to local technical logs.

Changing the UI language affects the next generation; it does not rewrite existing conversation messages.

## Device capability profiling

FreeAI Open estimates coarse device capability locally to pick a suitable mode/model recommendation, and to show device information in onboarding, Settings, and `/debug`. This check runs entirely in the browser and is never sent to a server.

Capability Profiler v2 stores only normalized, bounded categories: a form factor (`mobile`/`tablet`/`desktop`/`unknown`), an architecture class (`arm`/`x86`/`unknown`), memory and logical-processor classes (`low`/`medium`/`high`/`unknown`), WebGPU/WASM availability, fallback-adapter status, a technical device tier, and a product-facing capability class (`compatibility`/`light`/`balanced`/`performance`). `navigator.deviceMemory` is approximate browser-reported data, not free browser memory. `navigator.hardwareConcurrency` is coarsened before persistence.

When WebGPU exposes adapter information, FreeAI Open may read raw adapter strings in memory to derive coarse GPU classes such as vendor class (`nvidia`, `amd`, `intel`, `apple`, `qualcomm`, `arm`, `unknown`), broad architecture/description class, allowlisted feature classes, selected limit buckets, and optional low-confidence experimental memory buckets. Raw GPU names, device IDs, driver strings, exact VRAM, exact high-entropy limit maps, raw user-agent strings, touch-point values, and fingerprint hashes are not stored in local preferences, local logs, diagnostic reports, telemetry, or any server request.

The iPadOS desktop-style heuristic uses local browser signals only to choose the coarse `tablet` bucket when a `Macintosh`/`Mac OS` user agent is paired with multitouch support; the raw signals are not exposed. Browser-reported memory heaps are non-standard and low confidence; they are bucketed and can never alone promote a device to a performance recommendation. An optional, locally-supplied measured-performance value (tokens per second, load time, first-token time, recent failure count) can adjust the tier, but real benchmark/observation wiring is still future work.

## v0.7.0-alpha adaptive router inputs (Phases 0-1B)

Phase 0 defined local storage shapes. Phase 1A populates the static capability profile, Phase 1B adds static public model metadata, and Phase 2 populates the local benchmark result. Model-observation records remain future behavior.

- **Static capability profile:** a device's coarse, non-benchmarked capability signals (form factor, architecture class, approximate memory, WebGPU/WASM availability, and coarse GPU classes). Raw GPU adapter strings and exact high-entropy limit maps may be read momentarily by the profiler to derive these coarse classes, but must never be written to local storage, logs, diagnostics, or sent anywhere.
- **Local benchmark result:** the outcome of a short, local, privacy-safe WebGPU microbenchmark (technical timings, bounded compute score, responsiveness bucket, stability, confidence, and technical error code). It is stored locally for up to seven days and invalidated when its schema, benchmark version, expiry, or coarse capability-profile key changes. It is never transmitted and contains no raw adapter/device identifier.
- **Model performance observations:** technical timings and an outcome code (e.g. completed, stalled, out of memory) from a real local model load/generation attempt — never the prompt or response involved. Kept as a capped local history (200 most recent) so future routing can weigh real observed behavior alongside static signals.
- **Model registry records:** public technical metadata such as exact WebLLM model ID, source/license URLs, coarse suitability scores, estimates, requirements, and known issues. Registry code does not collect user/device data, persist a profile, log content, or perform a network request.

None of the local input records are conversation content, and none may ever be sent to a server, Supabase, or Google Drive. Registry metadata is committed public data rather than user data. A future router decision (also not implemented yet) will only ever include coarse categories, a benchmark status/score bucket, the selected model ID, and reason codes in any diagnostic export — never conversation content or raw hardware identifiers.

## Cancellation recovery

After Stop, the interrupted WebLLM worker is treated as potentially unsafe. FreeAI Open discards the partial assistant response, moves through a local `recovering` state, terminates the old worker, and reloads the cached model in a new runtime before enabling the next send action. Recovery events are local technical metadata only (`runtime.recovery.started`, `runtime.recovery.completed`, `runtime.recovery.failed`) and must not contain prompts, model replies, conversations, documents, or hidden language instructions.

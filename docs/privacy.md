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

Generation safety is an alpha safeguard against unstable local model output. If a reply is cancelled, fails, or is detected as degenerate output, FreeAI Open removes the partial assistant response from the chat UI and does not save it as a completed assistant message. As of v0.7.1-alpha, a genuine stall/timeout (the local model stopped responding — see `docs/architecture.md`'s "Generation timeout and stall watchdog") is a deliberate exception when it already produced visible text: that partial reply is preserved and saved, marked incomplete, instead of discarded; a stall/timeout that produced no output at all is still removed like the other cases. Technical events, local logs, and diagnostic reports are limited to metadata such as event names, statuses, error codes, lengths where applicable, and timing metrics; they must not include the generated text itself.

During normal streaming, the chat UI may briefly buffer generated text in memory before rendering it to reduce React update pressure. This buffer is not local technical logging, telemetry, diagnostic-report data, IndexedDB persistence, or server data. It is discarded after the generation path flushes or ends.

## Persistent runtime and navigation

The WebLLM runtime is owned by a root-level client provider so normal internal navigation does not unload the local model. Navigating from Chat to Settings or Debug and back keeps the same local worker/runtime when it is healthy, and an active generation can continue while the Chat route is temporarily unmounted.

The provider may keep technical runtime state, the current conversation ID, the current generation ID, model/backend metadata, and in-memory transcript UI state needed to keep streaming visible when the user returns to Chat. It must not write prompts, responses, conversation messages, uploaded document content, hidden language instructions, local file paths, API keys, or tokens into local technical logs, diagnostic reports, telemetry, server storage, Supabase, or any network path.

Conversation content remains local browser data. Completed messages are persisted through `@free-ai-open/conversation-store`; partial assistant output from a stopped, failed, or unstable generation is still removed and not saved. A genuine stall/timeout that already produced visible text is saved instead (see "Generation safety" above), marked incomplete rather than presented as a normal completed reply.

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

## v0.7.0-alpha adaptive router inputs and runtime integration (Phases 0-6)

Phase 0 defined local storage shapes. Phase 1A populates the static capability profile, Phase 1B adds static public model metadata, Phase 2 populates the local benchmark result, Phase 3 consumes these technical signals in a pure local decision function, Phase 4 applies that decision to real model loading and records real observations from it, Phase 5 exposes automatic/manual selection and plain-language explanations in the UI, and Phase 6 hardens every persistence/diagnostic/router boundary with the final strict allowlists and consent-safe fallback policy.

- **Static capability profile:** a device's coarse, non-benchmarked capability signals (form factor, architecture class, approximate memory, WebGPU/WASM availability, and coarse GPU classes). Raw GPU adapter strings and exact high-entropy limit maps may be read momentarily by the profiler to derive these coarse classes, but must never be written to local storage, logs, diagnostics, or sent anywhere.
- **Local benchmark result:** the outcome of a short, local, privacy-safe WebGPU microbenchmark (technical timings, bounded compute score, responsiveness bucket, stability, confidence, and technical error code). It is stored locally for up to seven days and invalidated when its schema, benchmark version, expiry, or coarse capability-profile key changes. It is never transmitted and contains no raw adapter/device identifier.
- **Model performance observations:** technical timings and an outcome code (e.g. completed, stalled, out of memory) from a real local model load/generation attempt — never the prompt or response involved. As of Phase 4 these are actually recorded, keyed by the registry model ID, from real `ai-runtime` load/generation events. Kept as a capped local history (200 most recent) so routing can weigh real observed behavior alongside static signals. Load attempts and generations are aggregated separately; a user pressing Stop is recorded as `cancelled` and excluded from model-instability rates.
- **Model registry records:** public technical metadata such as exact WebLLM model ID, source/license URLs, coarse suitability scores, estimates, requirements, and known issues. Registry code does not collect user/device data, persist a profile, log content, or perform a network request.

None of the local input records are conversation content, and none may ever be sent to a server, Supabase, or Google Drive. Registry metadata is committed public data rather than user data. Capability and observation stores rebuild exact allowlisted shapes before persistence; invalid dates, unknown GPU keys/classes, raw-like strings, unexpected fields, and private text placed in nominally technical fields are rejected or removed. The pure router repeats this normalization for direct callers. The decision itself contains only model IDs, bounded technical scores, token budgets, confidence, and stable reason/warning/rejection codes — no conversation content. It is kept in memory only (never written to `localStorage`), since it is cheap to recompute deterministically from the already-persisted capability/benchmark/observation inputs above. `/debug` displays the live decision (selected model, confidence, translated reason/warning codes, fallback chain, rejected models with reasons, recommended context/output token budgets) alongside an observations summary, matching the same allowlist discipline as every other diagnostic field in this document — never conversation content or raw hardware identifiers.

## Model download consent

Before FreeAI Open downloads a model that is neither already cached nor the existing pre-disclosed compatibility default (`SmolLM2-360M-Instruct-q4f32_1-MLC`, named with its approximate size during first-run Getting Started), it shows a plain-language prompt naming the model, its approximate download size, that it runs entirely on this device, and that the download may take time. Nothing downloads until the user confirms. This applies the very first time a model is ever selected, not only to later switches: if the router's initial pick needs consent, the disclosed default loads immediately so chat stays usable, and the prompt offers the upgrade separately. Automatic fallback attempts are limited to cached, explicitly approved, or first-run pre-disclosed models; a failed fallback cannot silently introduce another download. Declined and failed upgrades are remembered for the current session to prevent immediate prompt/retry loops. A pending prompt is never shown or acted on while a reply is being generated — a model switch is deferred, never forced, during active generation. Cache status is detected through the browser's real Cache Storage API (`ai-runtime`'s `isModelCached()`), never guessed from registry metadata. On a device detected as mobile, a model at or above 500 MB shows an additional warning about mobile data usage; this does not change the consent requirement itself, only the wording. Manually picking a model in `/settings` never bypasses this consent — the same rule applies whether the router or the user chose the model.

## Manual model selection preference

Whether model selection is "automatic" or "manual", and which model ID was manually chosen, is stored as a single local preference value (schema-versioned, same convention as every other local preference in this document), never sent to a server. It contains no conversation content and no device fingerprint — only a mode flag and a public registry model ID. `/settings`' manual model list shows each model's friendly name, approximate size, cached status (from the real Cache Storage check above, not guessed), and — behind a details disclosure — its exact technical ID, per-language suitability, recommended tasks, and device suitability, all sourced from the same public, committed registry metadata already described under "Model registry records." Until a capability-backed decision exists, manual model buttons remain disabled. A model the adaptive router has determined is ineligible for this device is shown disabled with the router's own rejection reason, never silently hidden.

## Cancellation recovery

After Stop, the interrupted WebLLM worker is treated as potentially unsafe. FreeAI Open discards the partial assistant response, moves through a local `recovering` state, terminates the old worker, and reloads the cached model in a new runtime before enabling the next send action. Recovery events are local technical metadata only (`runtime.recovery.started`, `runtime.recovery.completed`, `runtime.recovery.failed`) and must not contain prompts, model replies, conversations, documents, or hidden language instructions.

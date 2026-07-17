# Security design

## Security principles

- Privacy-first.
- Secure-by-default.
- Observable-by-design.
- Minimal server data.
- Explicit user control.

## Required protections

- Strict CSP. Not yet enforced (see `netlify.toml`); when added, it must allow-list or hash the small inline theme-init script in the root layout (a static, non-user-controlled snippet that reads a `localStorage` preference and sets `<html data-theme>` before hydration to avoid a theme flash), rather than broadly allowing inline scripts.
- No `eval`.
- No unnecessary remote scripts.
- Worker isolation for inference.
- Telemetry payload validation.
- Privacy redaction client-side and server-side.
- Forbidden telemetry fields rejected.
- Rate limiting on telemetry endpoint.
- Model registry validation.
- Model manifests with source, license, hash when possible.
- Dependency review.

## Threats to document

- XSS.
- Compromised model manifest.
- Compromised CDN/model source.
- Sensitive data in logs.
- Prompt injection in documents.
- WebGPU crash/device lost.
- Excessive fingerprinting.
- Storage exhaustion.
- Local conversation storage leakage.
- Malicious dependency.

## Local conversation storage

Conversations are sensitive local data. The conversation store must:

- stay browser-local;
- avoid `fetch`, `sendBeacon`, Supabase, Google Drive, and server endpoints;
- avoid local technical logs for message content;
- enforce limits on conversation count, message count, and message size;
- keep schema version metadata for future migrations;
- exclude conversation content from diagnostic reports.

Sprint 5.1 test coverage includes the real IndexedDB store through `fake-indexeddb`, no-IndexedDB memory fallback, active conversation ID pointer behavior, local-log rejection of conversation content fields, diagnostic-report exclusion of conversation-shaped input, and network isolation for conversation-store operations.

The store's optional per-conversation `task` field is a plain string passed through unvalidated at the storage layer (the app layer, not the store, validates/narrows it against the `TaskCategory` catalog); it is never prompt or response content and carries no additional privacy risk beyond the existing title field.

## Local conversation export/import

Conversation export files are sensitive local data because they can contain prompts and model responses. The export/import package must:

- stay local-only;
- avoid `fetch`, `sendBeacon`, Supabase, Google Drive, cloud storage, and server endpoints;
- reject unsupported formats and versions;
- reject invalid roles, invalid dates, oversized payloads, and unexpected fields;
- reject a `task` field that isn't a bounded string, while still accepting a file where `task` is absent entirely (older exports);
- assign fresh conversation IDs during import so existing conversations are not silently overwritten;
- keep exported/imported conversation content out of local technical logs and diagnostic reports.

The current export format is unencrypted JSON. Users should treat exported files as private data until encrypted export is implemented.

The `/chat` export/import UI enforces this at the app layer too: it calls only `conversation-export`/`conversation-store` public functions, never `fetch`, `sendBeacon`, a server endpoint, `logEvent`, local technical logs, or diagnostic reports, and it always imports conversations under fresh IDs rather than overwriting existing ones.

## Generation safety

The WebLLM runtime includes alpha safeguards for unstable model output:

- bounded `max_tokens` for generation requests;
- maximum generation duration;
- output character limits;
- detection for long unbroken sequences, repeated characters, and repeated punctuation/symbol blocks;
- technical-only events such as `inference.degenerate-output` and `inference.generation-timeout`.

When these safeguards fire, partial assistant output is not stored as a completed assistant message. Technical events, local logs, and diagnostic reports must contain only technical metadata such as error codes, runtime status, lengths where applicable, and timing metrics, never prompt or generated response text.

The chat transcript renderer may batch generated text briefly in memory before updating React state. This is a UI-only performance buffer, not a logging or diagnostic path, and must not be connected to telemetry, local technical logs, diagnostic reports, or server endpoints.

## Persistent runtime ownership

The WebLLM worker/runtime is owned by a root-level client provider, not by the `/chat` route component. This prevents route-view unmount from becoming a security-sensitive implicit teardown path: navigating to Settings or Debug must not cancel generation, unload the model, or terminate the worker by itself.

Allowed runtime disposal/replacement triggers are:

- application-root teardown;
- explicit Reload model;
- recovery after a stuck/interrupted worker;
- a validated future performance/model transition that actually requires replacement.

Route-view unmount and hidden-tab visibility changes are not disposal triggers. Browsers may throttle hidden tabs, but the app must not intentionally unload the model only because visibility changed.

Provider state may include runtime status, model/backend metadata, current conversation ID, current generation ID, and in-memory transcript UI state. None of that may be connected to local technical logs, diagnostic reports, telemetry, server storage, Supabase, Google Drive, or other network paths in a way that exposes prompt, response, document, or conversation content.

## Cancellation recovery

After a Stop request, the interrupted runtime must not be trusted as ready for the next generation merely because the stream returned an abort confirmation. The app now treats the old worker as unsafe after cancellation, enters `recovering`, tears down the old worker using bounded termination, creates a replacement runtime, and returns to `ready` only after the model reload succeeds.

Recovery events are allowlisted technical events only:

- `runtime.recovery.started`
- `runtime.recovery.completed`
- `runtime.recovery.failed`

These events may include runtime status and technical error codes, but must not include prompts, responses, documents, conversations, message arrays, hidden language instructions, local file paths, API keys, or tokens.

## Device capability profiling

`@free-ai-open/device-profiler` mitigates the "excessive fingerprinting" threat by construction:

- every persisted signal is a coarse, bounded category (`formFactor`, `architectureClass`, `memoryClass`, `cpuConcurrencyClass`, `capabilityClass`, GPU vendor/architecture/description classes, feature classes, and selected limit buckets), never a raw sensor reading, a raw user-agent string, or a combination precise enough to uniquely identify a device;
- architecture detection uses the Client Hints high-entropy API only when available and only reads the single `architecture` hint, never broader high-entropy fingerprinting hints;
- WebGPU adapter info may be read ephemerally to derive coarse GPU classes, but raw GPU names, device IDs, vendor/device strings, driver strings, exact high-entropy limits, exact VRAM, and fingerprint hashes must not be stored, logged, exported, or transmitted;
- fallback/software adapters are capped conservatively, and browser-reported experimental memory heaps are optional low-confidence buckets, not authoritative VRAM;
- the profiler never calls `fetch`, `sendBeacon`, or any server endpoint — profiling stays entirely local and synchronous with the existing onboarding/`/debug` display paths;
- an optional `measuredPerformance` input (tokens/sec, load/first-token time, recent failure count) is locally supplied only, never derived from remote data, and is not populated with real data by any current caller.

## v0.7.0-alpha adaptive router contracts (Phase 0)

Contracts and local persistence shapes exist, and Phase 1A now implements the static capability detector. Benchmark and router logic remain future work. Recorded here so the eventual implementation phases inherit the right constraints from the start:

- Hard compatibility gates must run before any scoring (an unverified model, an unavailable backend, a missing required WebGPU feature/limit, clearly insufficient memory, a known incompatibility, or repeated recent OOM/device-loss failures excludes a model outright).
- RAM alone must never determine model selection; exact VRAM must remain optional and never required.
- An experimental browser-reported GPU memory heap size is bonus data only, never authoritative.
- A future router must be deterministic for the same normalized input and registry version, and must return human-readable reason codes/messages for every decision — never a silent choice.
- Manual model override is allowed only for eligible models unless an explicitly designed advanced/unsafe override is added later.
- `StaticCapabilityProfile`'s `gpu` shape exposes only coarse classes and bounded feature/limit maps; there is no field for a raw adapter string, and a test in `packages/types/src/router-signals.test.ts` guards against one being added silently.
- `LocalBenchmarkResult`/`ModelPerformanceObservation` must stay technical-only (timings, status/outcome codes, confidence) — never prompt, response, or conversation content — matching the existing local-log/diagnostic-report allowlist discipline elsewhere in this document.
- The three new local stores (`apps/web/app/_lib/capabilityProfileStore.ts`, `benchmarkResultStore.ts`, `modelObservationStore.ts`) must stay `fetch`/`sendBeacon`-free, matching every other local-only store in this codebase.
- No new inter-package dependency edge was introduced while adding these contracts; `apps/web/app/_lib/packageDependencyBoundaries.test.ts` asserts `@free-ai-open/types` stays dependency-free and that `model-router`/`ai-runtime`/`model-registry`/`device-profiler` do not form a cycle, so a later phase that wires real logic gets an early test failure if it accidentally creates one.

## Runtime language instruction

The selected UI locale is converted to a hidden runtime-only system instruction before local inference. This instruction is allowed to enter the local WebLLM message list, but it must not be persisted in conversation history, exported in conversation backups, included in diagnostics, or written to local technical logs. Language adherence remains best effort and depends on the selected model.

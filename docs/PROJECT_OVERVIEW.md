# Project overview

## What FreeAI Open is

FreeAI Open is an open-source, local-first AI chat assistant that runs entirely in the browser using WebLLM. Instead of sending prompts and responses to a server, inference happens on the user's own device through WebGPU/WASM, inside a Web Worker.

The project is currently a small pnpm workspace: a Next.js web app plus a set of focused TypeScript packages for the browser runtime, device profiling, model routing, local conversation storage, structured local logging, and privacy-safe diagnostics.

## Why local-first browser AI is useful

Running inference in the browser instead of a server changes the privacy and cost trade-offs of a chat assistant:

- There is no prompt or response data to protect on a server, because it never arrives there.
- Users are not billed per token by a third-party API for normal chat use.
- The app can work without an account or a backend for its core chat experience.
- It forces a different kind of engineering discipline: the runtime has to handle a wide range of consumer hardware, WebGPU availability, and failure modes directly in the browser, and diagnostics have to be genuinely privacy-safe by construction rather than by policy alone.

The trade-off is real: browser-local models are smaller and slower than large hosted models, and browser/WebGPU support varies across devices. FreeAI Open is built around that trade-off rather than around hiding it.

## Current status: alpha

FreeAI Open is in **alpha / early development**. The current codebase is useful for development, testing, and early feedback, but it is not production-ready and should be expected to change between alpha releases. See [`CHANGELOG.md`](../CHANGELOG.md) for released versions and [`docs/DEVLOG.md`](DEVLOG.md) for the full sprint-by-sprint implementation history.

## What works today

- A browser-local WebLLM runtime, running in a Web Worker, with a streaming chat UI.
- Stop generation recovery: a `cancelling` state, cancel/stall timeouts, and a "Reload model" recovery path for a stuck runtime.
- Local conversation history in the `/chat` UI: create, resume, rename, and delete conversations, backed by IndexedDB with an in-memory fallback when IndexedDB is unavailable.
- Core local conversation export/import helpers for a versioned JSON file format.
- Local technical logs and a privacy-safe diagnostic report, both viewable and exportable from the `/debug` dashboard.
- Device profiling and task/mode-based model routing groundwork, with a small, explicit model registry.
- Strict schemas and redaction utilities that keep telemetry, logs, and diagnostics limited to technical metadata.

## What is not implemented yet

- Cloud or cross-device sync of conversations (no Supabase-backed or other cloud conversation storage).
- Google Drive sync.
- End-user export/import UI and encrypted conversation backups.
- An account system.
- A large or production-scale model catalog.
- Desktop or mobile packaging.
- Broad browser end-to-end test coverage (current tests are unit/integration level; browser flows are also checked manually before a release, see [`docs/RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)).

See [`docs/roadmap.md`](roadmap.md) for the current near-term and future plan.

## Privacy model

For normal chat usage, FreeAI Open does not send prompts, model responses, conversations, uploaded documents, or extracted document content to a server. Conversation history is stored locally in the browser (IndexedDB, with a temporary in-memory fallback). Local technical logs and diagnostic reports are built from allowlisted, redacted technical metadata only — they must not contain prompt, response, document, or conversation content.

Local storage is not the same as encryption: clearing browser site data removes local conversations, logs, and model cache data, and anyone with access to the device/browser profile can access that local data, same as any other browser-local storage. See [`docs/privacy.md`](privacy.md) and [`docs/security.md`](security.md) for the full design and current limitations.

## Why this is useful as open source

The interesting parts of this project — privacy-safe diagnostics, a runtime state machine that survives WebGPU/WebLLM failure modes, and a genuinely local conversation store — are exactly the kind of infrastructure that benefits from outside review: privacy claims are easier to trust when the redaction and storage boundaries are visible in the source, not just described in a policy page. Contributions, issue reports, and security reviews are welcome; see [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`SECURITY.md`](../SECURITY.md).

# FreeAI Open

Local-first AI chat in the browser, powered by WebLLM.

**Status: Alpha / early development.**

FreeAI Open is an open-source browser AI assistant focused on local inference, explicit privacy boundaries, and practical diagnostics. The current codebase is useful for development and testing, but it is not production-ready and should be expected to change between alpha releases.

Inference runs entirely on the user's device. Response speed and quality depend on the browser, WebGPU/WASM support, the device's hardware, and the model selected — not on a fixed server-side model.

## Why FreeAI Open?

Browser LLM runtimes make local AI possible without a native app, but the product layer around them is still immature. FreeAI Open explores that layer with a narrow set of goals:

- keep normal chat inference in the user's browser;
- make device capability and runtime status visible;
- provide a simple chat interface with local conversation history;
- keep telemetry, logs, and diagnostic exports limited to technical metadata;
- document what is implemented and what remains future work.

## Current features

Implemented in the current alpha:

- Browser-local WebLLM runtime through a Web Worker.
- Streaming chat UI.
- Stop generation recovery, including cancelling state, timeout handling, stalled-generation recovery, unstable-output detection, and reload model support.
- Local conversation history in the `/chat` UI.
- IndexedDB conversation storage with an in-memory fallback when IndexedDB is unavailable.
- Local conversation export/import in the `/chat` history sidebar: export the current conversation, export all conversations, or import a JSON export file, entirely on-device.
- Local technical logs stored in the browser.
- Privacy-safe diagnostic report generation and export.
- `/debug` dashboard for runtime status, device information, technical logs, and diagnostics.
- Device profiling and model routing groundwork.
- Strict schemas and redaction utilities for privacy-sensitive telemetry and logs.
- English/French UI language toggle (defaults to the browser's language, persisted locally) for the app shell, chat, conversation history, export/import, debug dashboard, and runtime status/error text.
- Light/dark/system theme toggle, persisted locally, with no flash of the wrong theme on reload.

## What is not implemented yet

The following are not implemented in this alpha:

- Google Drive sync.
- Supabase or other cloud conversation storage.
- Account system.
- Encrypted conversation export/import backups (current exports are plain, unencrypted JSON).
- Production-scale multi-model registry.
- Desktop or mobile apps.
- Broad browser end-to-end test coverage.
- Full UI translation coverage: onboarding, settings, and the model/task catalog are still English-only.

## Privacy model

For normal chat usage, FreeAI Open does not send prompts, model responses, conversations, uploaded documents, or extracted document content to the server.

Conversation history is stored locally in the browser using IndexedDB. If IndexedDB is unavailable, the app can fall back to temporary in-memory storage for the session.

Diagnostics and local technical logs are built from allowlisted metadata such as event names, runtime status, backend, device tier, model ID, error code, and coarse performance metrics. They are passed through privacy redaction and must not include prompt text, response text, documents, messages, or conversation content.

Local storage is not the same as encryption. Clearing browser site data can remove local conversations, logs, and model cache data. Encrypted backup and sync are future work.

## Architecture

The repository is a pnpm workspace with a Next.js web app and focused TypeScript packages.

- `apps/web`: Next.js application, chat UI, onboarding, settings, and debug dashboard.
- `packages/ai-runtime`: browser runtime wrapper and WebLLM worker integration.
- `packages/conversation-store`: local-only conversation persistence.
- `packages/conversation-export`: versioned local JSON conversation export/import helpers.
- `packages/local-logs`: browser-local technical log storage.
- `packages/diagnostic-report`: privacy-safe diagnostic report builder.
- `packages/privacy-redactor`: forbidden field and sensitive-content redaction.
- `packages/telemetry`: technical telemetry schemas and validation.
- `packages/logger`: structured technical logging.
- `packages/device-profiler`: browser/device capability estimation.
- `packages/model-registry`: model metadata and validation.
- `packages/model-router`: task, mode, and device-based model selection.

Runtime AI code, WebGPU, WebLLM, IndexedDB, Cache Storage, browser APIs, and Web Workers must stay on the client side.

## Getting started

Requirements:

- Node.js compatible with the current Next.js version.
- pnpm 11.x.

Install dependencies:

```bash
pnpm install
```

Start the web app:

```bash
pnpm dev
```

Then open the local Next.js URL printed by the dev server, usually `http://localhost:3000`.

## Development checks

Run the main checks before merging:

```bash
pnpm -r typecheck
pnpm -r test
pnpm lint
pnpm build
```

## Documentation

- [Project overview](docs/PROJECT_OVERVIEW.md)
- [Project brief](PROJECT_BRIEF.md)
- [Changelog](CHANGELOG.md)
- [Development log](docs/DEVLOG.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Privacy design](docs/privacy.md)
- [Security design](docs/security.md)
- [Telemetry design](docs/telemetry.md)
- [Model selection](docs/model-selection.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Architecture decision records](docs/adr/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Roadmap

Near-term work is tracked in [docs/roadmap.md](docs/roadmap.md). Current priorities include stronger browser-level testing, clearer model selection, and continued privacy/security hardening.

Future ideas such as Google Drive sync, encrypted backup, model mirrors, desktop packaging, and broader model support are not part of the current alpha.

## License

Apache License 2.0. See [LICENSE](LICENSE).

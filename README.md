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

- A coherent application shell (compact desktop navigation rail, safe-area-aware mobile top bar) and a product-wide visual redesign based on the FreeAI Open brand system, with plain-language device/runtime status by default and technical detail available on demand. On desktop, `/chat` is a fixed-height workspace with an independently scrolling conversation list and message transcript and an anchored composer.
- A first-run "Getting Started" flow (device detection, optional short local benchmark, first-model download disclosure, performance mode confirmation) shown once and persisted locally, plus a `/settings` page to change performance mode, language, theme, re-check the device, or reset first-time setup.
- Per-conversation usage selection: starting a new chat asks what it's for (general conversation, writing, rewriting, summarizing, translation, coding, or learning) instead of a single upfront choice, and the answer is preserved through local export/import.
- Browser-local WebLLM runtime through a Web Worker, owned by a stable app-level provider so the loaded local model survives normal internal navigation between Chat, Settings, and Debug.
- Streaming chat UI with a multiline composer.
- Stop generation recovery, including cancelling/recovering states, timeout handling, stalled-generation recovery, automatic runtime recycling, unstable-output detection, and reload model support.
- Active generation state that can continue across internal route navigation when the browser allows it; background tabs may still be throttled by the browser or mobile OS.
- Local conversation history in the `/chat` UI, with an accessible off-canvas navigation drawer for switching conversations on mobile, opened from a persistent button that stays reachable while scrolling.
- IndexedDB conversation storage with an in-memory fallback when IndexedDB is unavailable.
- Local conversation export/import in the `/chat` history sidebar: export the current conversation, export all conversations, or import a JSON export file, entirely on-device.
- Local technical logs stored in the browser.
- A short, optional local WebGPU capability check during setup, cached for seven days and rerunnable or clearable from Settings; its coarse result remains on-device and informs the adaptive router alongside capability data and real local model observations.
- Privacy-safe diagnostic report generation and export.
- `/debug` dashboard for the current runtime/router state, device information, technical logs, and privacy-safe diagnostics.
- Device profiling, a local capability benchmark, a five-model Registry v2, and an adaptive router that drives real model loading, safe switching, and local observation recording. A `/settings` panel offers automatic (recommended) or manual model selection with friendly model info, and chat shows a short plain-language reason for the model that was picked; a non-default, non-cached model always asks for confirmation (approximate size, that it runs locally) before downloading.
- Strict schemas and redaction utilities for privacy-sensitive telemetry and logs.
- English/French UI language toggle (defaults to the browser's language, persisted locally) across the public app surfaces.
- Best-effort local model response language based on the selected UI locale through a hidden runtime-only instruction. Actual language quality depends on the selected model.
- Light/dark/system theme toggle, persisted locally, with no flash of the wrong theme on reload.

## What is not implemented yet

The following are not implemented in this alpha:

- Google Drive sync.
- Supabase or other cloud conversation storage.
- Account system.
- Encrypted conversation export/import backups (current exports are plain, unencrypted JSON).
- A production-scale model catalog (the current Registry v2 is a curated five-model foundation).
- Desktop or mobile apps.
- Broad browser end-to-end test coverage.
- Guaranteed multilingual model quality across every model.

## Privacy model

For normal chat usage, FreeAI Open does not send prompts, model responses, conversations, uploaded documents, or extracted document content to the server.

Conversation history is stored locally in the browser using IndexedDB. If IndexedDB is unavailable, the app can fall back to temporary in-memory storage for the session.

Diagnostics and local technical logs are built from allowlisted metadata such as event names, runtime status, backend, device tier, model ID, error code, and coarse performance metrics. They are passed through privacy redaction and must not include prompt text, response text, documents, messages, or conversation content.

The hidden language instruction used to guide local model replies is runtime-only. It is not stored in conversation history, exported with conversation backups, included in diagnostic reports, or written to local technical logs.

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
- [Brand guide](docs/brand.md)
- [Roadmap](docs/roadmap.md)
- [Privacy design](docs/privacy.md)
- [Security design](docs/security.md)
- [Telemetry design](docs/telemetry.md)
- [Model selection](docs/model-selection.md)
- [Model registry](docs/model-registry.md)
- [Model verification](docs/model-verification.md)
- [Model attributions and licenses](docs/model-attributions.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Architecture decision records](docs/adr/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Roadmap

Near-term work is tracked in [docs/roadmap.md](docs/roadmap.md). Current priorities include stronger browser-level testing, clearer model selection, and continued privacy/security hardening.

Future ideas such as Google Drive sync, encrypted backup, model mirrors, desktop packaging, and broader model support are not part of the current alpha.

## License

Apache License 2.0. See [LICENSE](LICENSE).

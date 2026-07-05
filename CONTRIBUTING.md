# Contributing to FreeAI Open

Thanks for your interest in contributing. FreeAI Open is in **alpha / early development**: expect incomplete features, rough edges, and breaking changes between alpha releases. This document explains how to get set up and what is expected from a pull request.

## Project status

This is an early-stage open-source project, not a production service. Contributions are welcome, but please expect design decisions to still be evolving, especially around model selection, storage limits, and future sync features.

## Getting set up

Requirements:

- Node.js compatible with the current Next.js version.
- pnpm 11.x.

```bash
pnpm install
pnpm dev
```

Then open the local Next.js URL printed by the dev server, usually `http://localhost:3000`.

## Before opening a pull request

Run the full check suite locally:

```bash
pnpm -r typecheck
pnpm -r test
pnpm lint
pnpm build
```

All four must pass. If a check fails and you believe it is unrelated to your change, say so explicitly in the PR description rather than skipping it.

For UI or runtime changes, also do a manual browser check of the affected flow (chat, stop/reload, conversation history, debug dashboard) — automated tests do not fully cover browser runtime behavior yet.

## Privacy and security expectations

FreeAI Open's core promise is that prompts, model responses, uploaded documents, and conversation history stay on the user's device by default. Contributions must not weaken this:

- Do not log prompt, response, document, or conversation content in local technical logs, diagnostic reports, or console output.
- Do not add a `fetch`, `sendBeacon`, or server endpoint call for conversation or document content.
- Do not add Supabase, Google Drive, or any other cloud storage/sync path for conversations without an explicit design discussion first (open an issue or a draft PR to discuss the approach before implementing).
- Any new telemetry field must go through the existing privacy redaction and allowlist logic, and must be technical only (no content).
- See [`docs/privacy.md`](docs/privacy.md) and [`docs/security.md`](docs/security.md) for the full rules.

## Documentation must stay in sync with code

If your change affects behavior, architecture, runtime states, privacy/security guarantees, logging, telemetry, diagnostics, model routing, or storage, update the relevant docs in the same PR:

- [`README.md`](README.md)
- [`CHANGELOG.md`](CHANGELOG.md)
- [`docs/DEVLOG.md`](docs/DEVLOG.md)
- [`docs/architecture.md`](docs/architecture.md), [`docs/privacy.md`](docs/privacy.md), or [`docs/security.md`](docs/security.md) if relevant

Do not describe a feature as implemented if it is only partially working or planned. Known limitations are expected and should be written down, not hidden.

## Code style

- TypeScript strict mode.
- Prefer small, focused packages and files with clear boundaries over large multi-purpose modules.
- Avoid large monolithic `index.ts` files. A package-level `index.ts` is fine for a small, intentional public API; it should not become a dumping ground for unrelated exports.
- Prefer pure functions for router/profiler/redactor-style logic, and add tests alongside security- or privacy-sensitive code.
- No `console.log` in production code paths — use the structured logger.

## Pull requests

- Keep PRs small and scoped to one concern. A focused PR is easier to review and safer to merge than a broad rewrite.
- Fill out the PR template, including the privacy/security and local storage impact sections.
- Explain what was tested and how, including any known limitations left behind.

## Reporting bugs and security issues

- Use the "Bug report" issue template for functional bugs. Do not paste private prompts, responses, or documents — use the redacted debug report from `/debug` if relevant.
- Use the "Privacy/security report" issue template for anything involving unexpected data leaving the browser, or conversation/log/diagnostic content leakage.
- See [`SECURITY.md`](SECURITY.md) for how to report a vulnerability responsibly.

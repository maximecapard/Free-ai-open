# CLAUDE.md — Claude Code project memory

You are working on **FreeAI Open**, an open-source, privacy-first browser AI assistant.

## Claude Code role

Claude Code is the main local architect and integrator.

Prioritize:

- repo architecture;
- Next.js app integration;
- WebLLM/WebGPU client runtime;
- Web Workers;
- IndexedDB integration;
- UI flow integration;
- final merge coherence;
- debugging multi-file issues.

Codex is used in parallel for isolated modules, tests, docs, security review, telemetry schemas, and PR review.

## Core product constraints

FreeAI Open must feel like a consumer product, not a dev demo.

The user should choose:

- what they want to do;
- desired performance level;
- optional manual model selection.

The app should hide technical model complexity by default, while keeping advanced details accessible.

## Runtime constraints

- WebLLM/WebGPU/WASM must run only in the browser.
- Use Client Components and Web Workers.
- Do not import browser-only packages in Server Components.
- Do not attempt server-side inference.

## Privacy constraints

Never send these to the server:

- prompts;
- model responses;
- uploaded documents;
- conversation history;
- local files;
- secrets.

Telemetry can send technical data only after redaction.

## Preferred implementation order

1. Build stable Next.js app shell.
2. Create model registry types.
3. Implement simple chat UI.
4. Integrate WebLLM in a worker.
5. Add local storage.
6. Add device profiler.
7. Add model router.
8. Add structured logger.
9. Add telemetry endpoint.
10. Add debug dashboard.
11. Add export/import.

## Commit style

Use small, scoped commits:

- `chore: bootstrap next app`
- `feat(runtime): add webllm worker wrapper`
- `feat(router): select model by task and device tier`
- `test(redactor): cover secrets and forbidden fields`
- `docs: add telemetry policy`

## Documentation rule

Documentation must stay in sync with the code. When a task changes behavior, architecture, runtime states, privacy/security guarantees, logging, telemetry, diagnostics, model routing, storage, or developer workflow, update all relevant documentation files in the same branch. Do not document unimplemented features as completed.

## Before finishing any task

Run or mention:

- lint;
- typecheck;
- tests;
- manual browser check when relevant;
- privacy/security implications.

- Do not create large monolithic index.ts or barrel files.
- Do not use index.ts as a dumping ground for unrelated exports.
- Prefer small focused files and explicit imports.
- A package-level index.ts is allowed only for tiny, intentional public APIs.
- Avoid re-exporting entire modules when it makes dependencies unclear or hurts tree-shaking.
- Documentation must stay in sync with the code. When a task changes behavior, architecture, runtime states, privacy/security guarantees, logging, telemetry, model routing, debugging, or developer workflow, update the relevant documentation files in the same branch. Do not document unimplemented features as completed.
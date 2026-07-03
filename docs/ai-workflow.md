# Claude Code + Codex workflow

## Goal

Use Claude Code and Codex in parallel without wasting quota or creating merge conflicts.

## Role split

### Claude Code

Claude Code is the main architect and integrator.

Use it for:

- Next.js app architecture;
- UI integration;
- WebLLM runtime integration;
- Web Workers;
- IndexedDB integration;
- debugging complex multi-file issues;
- resolving merge conflicts;
- final integration into `dev`.

### Codex

Codex is the parallel specialist.

Use it for:

- isolated packages;
- tests;
- schemas;
- redaction;
- docs;
- CI;
- PR review;
- security review;
- refactors with a limited scope.

## Branching rules

Never let two agents work on the same files at the same time.

Recommended branches:

```txt
feature/claude-bootstrap
feature/claude-webllm-runtime
feature/codex-device-profiler
feature/codex-model-registry
feature/codex-privacy-redactor
feature/codex-telemetry-schema
```

## Good parallel work example

Claude Code:

```txt
Implement the chat UI and WebLLM worker integration.
Do not touch privacy-redactor or telemetry schemas.
```

Codex:

```txt
Implement the privacy-redactor package with tests.
Do not touch apps/web.
```

## Bad parallel work example

Claude Code and Codex both rewrite the chat page. This creates conflicts and duplicated architecture.

## Review loop

1. Agent finishes branch.
2. Agent runs lint/typecheck/tests.
3. Codex reviews Claude Code changes.
4. Claude Code integrates Codex modules.
5. You manually test the app.
6. Merge into `dev`.
7. Merge stable `dev` into `main`.

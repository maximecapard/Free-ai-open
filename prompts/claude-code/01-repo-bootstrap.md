# Claude Code task — repo bootstrap

You are the main architect/integrator for FreeAI Open.

Read first:

- README.md
- PROJECT_BRIEF.md
- AGENTS.md
- CLAUDE.md
- docs/architecture.md
- docs/roadmap.md

## Objective

Make the repository runnable and coherent as a Next.js + TypeScript monorepo scaffold.

## Tasks

1. Inspect the current scaffold.
2. Fix package/workspace configuration if needed.
3. Ensure `pnpm install`, `pnpm typecheck`, `pnpm test`, and `pnpm build` can run or document exact blockers.
4. Keep the project architecture from `docs/architecture.md`.
5. Do not implement WebLLM yet unless needed for stubs.
6. Do not add external services yet.
7. Add missing minimal config files if required.
8. Ensure browser-only code stays in Client Components or workers.

## Constraints

- Do not send prompts/responses/documents to any server.
- Do not introduce telemetry beyond the placeholder endpoint.
- Do not remove docs/prompts/tickets.

## Definition of done

- App shell loads locally.
- TypeScript strict mode is enabled.
- Workspaces are coherent.
- Summary includes commands run and remaining blockers.

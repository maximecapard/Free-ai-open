# TODO — deferred setup review items

Items from the setup review (2026-07-04) that are real but are either
feature work, architecture decisions, or "nice to have" scaffolding —
deliberately left out of the setup-fix pass to keep that change minimal.
Not blocking a first commit.

## Security / privacy follow-ups (feature work, needs its own ticket)

- Telemetry API route (`apps/web/app/api/telemetry/route.ts`) has no
  request size limit and no rate limiting yet, even though
  `docs/security.md` requires rate limiting. Tracked implicitly by
  `tickets/phase-5-security.md` — implement there, not as a setup fix.
- CSP is intentionally not hardened yet (`netlify.toml` says so in a
  comment). Needs real directives once WebLLM/WebGPU/WASM/worker/blob
  requirements are known. Also tracked by `tickets/phase-5-security.md`.
- `packages/privacy-redactor` forbidden-field list does not include
  `localFilePath`, even though `docs/telemetry.md` and `AGENTS.md` list
  local file paths as forbidden. Worth adding once the field naming
  convention for file paths is settled (not currently emitted anywhere).
- `packages/device-profiler` and `packages/local-storage` use browser-only
  APIs (`navigator`, `WebAssembly`, `indexedDB`) but nothing currently
  marks them as client-only or prevents a future accidental import from a
  Server Component. Not broken today (nothing imports them yet), but
  worth adding a `"use client"` guard or a lint rule once `apps/web`
  starts consuming these packages.

## Data modeling (non-blocking, discuss before changing)

- `packages/model-registry` schema: `tasks` is `z.array(z.string())`
  instead of being constrained to `TaskCategory` from `@free-ai-open/types`,
  and `modelUrl` is a free-form string with no format validation. Tightening
  this is a real improvement but changes the public schema shape — do as a
  deliberate follow-up, not a silent setup fix.

## Toolchain / compatibility to validate

- Confirm whether `next.config.mjs` needs `transpilePackages` for the
  workspace `packages/*` (they ship raw TypeScript, no build step). The
  current build succeeded without it, but this should be re-checked once
  `apps/web` actually imports these packages at runtime (currently unused
  in `app/`).

## Missing OSS scaffolding (not required for a first commit)

- `CONTRIBUTING.md`
- `SECURITY.md` (root or `.github/SECURITY.md`)
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md`
- `.editorconfig`
- Shared Prettier config file (currently relies on Prettier defaults)

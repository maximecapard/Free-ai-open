# Roadmap

## Status after v0.5.0-alpha

Local conversation history (store + `/chat` history sidebar) shipped in `v0.5.0-alpha`. Next up:

- **Sprint 6 (next):** local export/import of conversations.
- **Future:** client-side encrypted export.
- **Future:** optional Google Drive sync.
- **Future:** better/more transparent model selection.
- **Future:** benchmarks page.

None of the "Future" items above are implemented yet. See the detailed phases below for full scope.

## Phase 0 — Project setup

- Next.js scaffold
- TypeScript strict
- Tailwind/shadcn setup
- AGENTS.md and CLAUDE.md
- docs baseline
- package structure
- CI baseline

## Phase 1 — Local AI prototype

- Integrate WebLLM
- Web Worker runtime boundary
- One compatible lightweight model
- Basic chat UI
- Streaming responses
- Stop generation
- Runtime error handling

## Phase 2 — Consumer UX

- Onboarding
- Fast / Balanced / Performance mode
- Task categories
- User-friendly model names
- Manual advanced selection

## Phase 3 — Device Profiler + Model Router

- Detect WebGPU/WASM
- Estimate device tier
- Model registry
- Router rules
- Fallback decisions
- Router explanation

## Phase 4 — Logging + telemetry

- Structured local logger
- Privacy redactor
- Redacted telemetry endpoint
- Supabase telemetry tables
- Debug report export
- `/debug` dashboard

## Phase 5 — Security hardening

- CSP
- Headers
- Hash/checksum model manifests
- Server validation
- Rate limiting
- Threat model
- Security docs

## Phase 6 — Local backup

- Export history
- Import history
- Encrypted `.freeai` format
- Schema migration tests

## Phase 7 — Benchmarks

- `/benchmarks` page
- tokens/sec
- load time
- first token
- browser compatibility

## Phase 8 — Google Drive sync

- Optional Google auth
- limited scopes
- client-side encryption
- Drive backup/restore

## Phase 9 — Model mirror

- Cloudflare R2
- browser-optimized model variants
- manifests
- hashes
- public benchmarks

## Phase 10 — Desktop

- PWA first
- Tauri desktop app
- larger local models
- better storage controls

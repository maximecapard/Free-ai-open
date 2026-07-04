# FreeAI Open

**FreeAI Open** is an open-source, local-first AI assistant running directly in the browser.

The project aims to turn browser LLM runtimes such as WebLLM into a real consumer-facing product:

- ChatGPT-like interface
- Local inference through WebGPU/WASM
- Automatic device profiling
- Task-based model routing
- Fast / Balanced / Performance modes
- Manual advanced model selection
- Local conversation storage
- Privacy-first technical telemetry
- Debug dashboard
- Public documentation
- Future encrypted Google Drive sync
- Future optimized browser model mirror

> Local by default. Observable when it breaks. Private always.

## Recommended stack

- **Framework:** Next.js + TypeScript
- **UI:** Tailwind CSS + shadcn/ui
- **Deployment:** Netlify
- **AI runtime:** WebLLM first
- **Models:** Hugging Face first, Cloudflare R2 mirror later
- **Private local data:** IndexedDB + Cache Storage
- **Backend/data:** Supabase
- **Telemetry:** Netlify API route/function -> Supabase
- **Future sync:** Google Drive, client-side encrypted
- **Future desktop:** Tauri

## Non-negotiable privacy rules

FreeAI Open must never send these to the server by default:

- user prompts
- AI responses
- uploaded documents
- chat history
- local files
- API keys
- personal content

Allowed server telemetry is technical only:

- error codes
- WebGPU/WASM failures
- selected model ID
- performance mode
- task category
- app version
- approximate browser/OS family
- load time / first token / tokens per second
- fallback result

## Quick start for a new repo

This template is intentionally a **project scaffold**, not a complete app. Use it to create the GitHub repo, then let Claude Code and Codex implement it phase by phase.

1. Create a new GitHub repository named `free-ai-open`.
2. Copy all files from this template into the repo.
3. Run `pnpm install` or adapt to npm if you prefer.
4. Read `AGENTS.md`, `CLAUDE.md`, and `docs/ai-workflow.md`.
5. Start with `prompts/claude-code/01-repo-bootstrap.md` in Claude Code.
6. Run Codex in parallel with isolated tasks from `prompts/codex/`.
7. Use PRs or branches for every agent task.

## Suggested branch workflow

```txt
main
  stable release branch

dev
  integration branch

feature/claude-runtime-webllm
feature/codex-device-profiler
feature/codex-privacy-redactor
feature/codex-model-router-tests
```

One agent, one branch, one clear scope.

## Documentation map

- `PROJECT_BRIEF.md` — presentation document
- `CHANGELOG.md` — versioned alpha milestone history
- `docs/DEVLOG.md` — sprint-by-sprint development history
- `docs/adr/` — architecture decision records
- `docs/architecture.md` — technical architecture
- `docs/roadmap.md` — implementation phases
- `docs/ai-workflow.md` — how Claude Code and Codex should work together
- `docs/privacy.md` — privacy policy and non-negotiable rules
- `docs/security.md` — security design
- `docs/telemetry.md` — technical telemetry design
- `docs/model-selection.md` — model routing strategy
- `docs/drive-sync.md` — future encrypted Google Drive sync
- `prompts/` — ready-to-use prompts for Claude Code and Codex
- `tickets/` — phase-by-phase task cards

## Development history

For the current alpha history, see:

- `CHANGELOG.md` for release-oriented changes and tagged alpha milestones.
- `docs/DEVLOG.md` for sprint-level implementation notes, privacy boundaries, and known remaining limits.

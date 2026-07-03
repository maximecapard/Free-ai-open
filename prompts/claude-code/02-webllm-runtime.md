# Claude Code task — WebLLM runtime integration

## Objective

Implement the first browser-only AI runtime integration using WebLLM in a Web Worker.

## Read first

- AGENTS.md
- CLAUDE.md
- docs/architecture.md
- packages/ai-runtime/src/index.ts
- apps/web/workers/inference.worker.ts

## Requirements

1. Integrate WebLLM only in browser/worker code.
2. Do not import WebLLM in Server Components.
3. Create a runtime wrapper with clear states:
   - idle
   - loading_model
   - ready
   - generating
   - error
4. Support streaming tokens back to the UI.
5. Support abort/stop generation.
6. Emit structured local log events.
7. Never log prompt content.
8. Only log prompt length.
9. Use the model registry types.
10. Add graceful error handling for WebGPU unavailable and model load failure.

## Out of scope

- Supabase persistence.
- Google Drive sync.
- R2 mirror.
- Multiple models beyond one test model.

## Definition of done

- Chat page can initialize runtime.
- User can send a prompt locally.
- Tokens stream into UI.
- Stop generation works or is clearly stubbed.
- Runtime errors are displayed without leaking content.
- Typecheck passes.

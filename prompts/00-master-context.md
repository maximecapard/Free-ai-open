# Master context for AI agents

You are working on FreeAI Open.

FreeAI Open is an open-source, local-first, privacy-first browser AI assistant. It runs LLM inference locally in the user's browser using WebLLM/WebGPU/WASM. It provides a ChatGPT-like interface, automatic device profiling, Fast/Balanced/Performance modes, task-based model routing, manual model selection, local conversation storage, technical telemetry, and a debug dashboard.

The server must never receive user prompts, AI responses, uploaded documents, or chat history by default.

Technical telemetry is allowed only if redacted and content-free.

The stack is:

- Next.js + TypeScript
- Tailwind + shadcn/ui later
- Netlify deployment
- Supabase for structured technical data
- WebLLM for browser inference
- Hugging Face for models initially
- IndexedDB for local private data
- Cloudflare R2 later for optimized model mirrors
- Google Drive later for encrypted user-owned sync

Always follow `AGENTS.md` and `CLAUDE.md`.

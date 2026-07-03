# FreeAI Open — Project brief

## One-line pitch

FreeAI Open is an open-source browser-based local AI assistant that automatically selects the best model for the user's device and task while keeping conversations private on the user's machine.

## Problem

Local AI is powerful but difficult for non-technical users:

- model names are confusing;
- users do not know what their machine can run;
- local AI tools often require setup;
- browser-based runtimes are mostly developer-facing;
- cache deletion can erase conversations;
- privacy guarantees are often unclear;
- debugging compatibility issues is hard.

## Solution

FreeAI Open provides a consumer-friendly layer above browser LLM runtimes:

- simple onboarding;
- automatic device profiling;
- Fast / Balanced / Performance modes;
- task-based model routing;
- manual advanced model selection;
- local conversation storage;
- clear privacy controls;
- anonymized technical telemetry;
- debug dashboard;
- future encrypted Drive sync;
- future optimized browser model mirror.

## Core principle

The server never processes user prompts or model responses. Inference happens locally in the browser.

## MVP scope

The first MVP should include:

1. Next.js app shell.
2. Chat interface.
3. WebLLM runtime in a Web Worker.
4. One small compatible model.
5. Local conversation persistence in IndexedDB.
6. Basic device profiler.
7. JSON model registry.
8. Basic model router.
9. Structured local logger.
10. Redacted technical telemetry endpoint.
11. Debug page.
12. Public docs.

## Explicitly out of MVP

- Custom LLM engine from scratch.
- Desktop app.
- Google Drive sync.
- Cloudflare R2 model mirror.
- Complex user accounts.
- Server-side conversation storage.
- Too many models.
- Fine-tuning.

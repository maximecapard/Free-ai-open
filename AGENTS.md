# AGENTS.md — FreeAI Open AI coding rules

This file defines repository-wide instructions for AI coding agents.

## Project identity

FreeAI Open is a privacy-first, local-first, open-source browser AI assistant.

The app runs LLM inference locally in the user's browser using WebLLM/WebGPU/WASM. The server is only used for hosting, model registry metadata, technical telemetry, and future optional features.

## Non-negotiable rules

1. Never send user prompts to the server by default.
2. Never send AI responses to the server by default.
3. Never send uploaded documents or extracted document content to the server by default.
4. Never store user conversations in Supabase by default.
5. Runtime AI code must run client-side only.
6. WebGPU, WebLLM, IndexedDB, Cache Storage, browser APIs, and Web Workers must not be imported in Server Components.
7. Any telemetry event must pass through privacy redaction before leaving the browser.
8. Any server endpoint receiving telemetry must validate and reject forbidden fields.
9. Do not use `console.log` in production code. Use the structured logger.
10. Add tests for model routing, telemetry schemas, privacy redaction, and security-sensitive logic.
11. Do not introduce new third-party services without documenting the reason in `docs/architecture.md`.
12. Do not add model records without source, license, backend, estimated size, status, and compatibility metadata.

## Allowed telemetry fields

Allowed examples:

- event name
- severity
- app version
- backend: webgpu, wasm, cpu
- browser family
- OS family
- device tier
- performance mode
- task category
- model ID
- error code
- load time
- first token time
- tokens per second
- fallback attempted/result
- prompt length only, never prompt content
- response length only, never response content

Forbidden fields:

- prompt
- response
- message content
- document content
- chat history
- API keys
- access tokens
- email content
- local file paths
- unredacted personal data

## Coding standards

- TypeScript strict mode.
- Prefer small packages with clear boundaries.
- Prefer pure functions for router/profiler/redactor logic.
- Add tests before or with security-sensitive code.
- Avoid global mutable state except controlled client stores.
- Keep app code readable and documented.
- Do not over-engineer beyond the current phase.

## Architecture boundaries

- `apps/web` contains the Next.js application.
- `packages/ai-runtime` wraps WebLLM and browser inference.
- `packages/device-profiler` estimates device capability.
- `packages/model-router` selects a model from the registry.
- `packages/model-registry` stores model metadata and validation.
- `packages/local-storage` handles IndexedDB and local-only data.
- `packages/logger` defines structured logs.
- `packages/privacy-redactor` removes sensitive data.
- `packages/telemetry` defines schemas and client/server telemetry logic.
- `packages/server-data` wraps Supabase access.

## Agent workflow

- Work on a dedicated branch.
- Keep scope narrow.
- Do not modify unrelated modules.
- Run lint, typecheck, and tests before finalizing.
- Summarize what changed, what was not changed, and known risks.

## Definition of done

A task is done only when:

- the code builds;
- tests pass or known failures are documented;
- new public behavior is documented;
- privacy rules are respected;
- telemetry has no sensitive content;
- the implementation does not violate the project architecture.

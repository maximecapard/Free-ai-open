# Coding standards

## TypeScript

- Use strict mode.
- Export explicit types from packages.
- Prefer small pure functions for router/profiler/redactor.
- Avoid `any` except with a documented reason.

## React / Next.js

- Use Server Components by default for static pages.
- Use Client Components for interactive/browser-only code.
- Never import WebLLM/WebGPU/IndexedDB into Server Components.
- Keep WebLLM in a Worker boundary.

## Logging

- No raw `console.log` in production code.
- Use structured logger.
- Never log content.
- Always include `contentLogged: false` for telemetry.

## Tests

Must be tested:

- model router;
- privacy redactor;
- telemetry schema;
- device profiler pure logic;
- local-storage migrations;
- server validation.

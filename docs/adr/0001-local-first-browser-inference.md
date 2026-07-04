# ADR 0001 - Keep inference local by default

## Status

Accepted

## Context

FreeAI Open is a privacy-first browser assistant. The core product promise is that user prompts, model responses, uploaded documents, and conversation history stay on the user's device by default.

The project uses browser LLM runtimes such as WebLLM. These runtimes depend on browser APIs such as WebGPU, Web Workers, IndexedDB, and Cache Storage. Those APIs must not be imported into Server Components or server endpoints.

## Decision

Run AI inference client-side only by default.

Runtime code must live behind Client Component and Web Worker boundaries. The server may host the app, serve model registry metadata, and receive redacted technical telemetry, but it must not process prompt text or model response text.

## Consequences

- Privacy boundaries are simpler to reason about: prompt and response content should not cross the network boundary.
- Runtime code must handle browser compatibility, WebGPU availability, and local failure modes.
- The app needs robust local diagnostics because runtime failures happen on user devices.
- Server-side inference, server-side conversation storage, and default Supabase conversation persistence are out of scope unless a future ADR changes this decision.

# Security design

## Security principles

- Privacy-first.
- Secure-by-default.
- Observable-by-design.
- Minimal server data.
- Explicit user control.

## Required protections

- Strict CSP. Not yet enforced (see `netlify.toml`); when added, it must allow-list or hash the small inline theme-init script in the root layout (a static, non-user-controlled snippet that reads a `localStorage` preference and sets `<html data-theme>` before hydration to avoid a theme flash), rather than broadly allowing inline scripts.
- No `eval`.
- No unnecessary remote scripts.
- Worker isolation for inference.
- Telemetry payload validation.
- Privacy redaction client-side and server-side.
- Forbidden telemetry fields rejected.
- Rate limiting on telemetry endpoint.
- Model registry validation.
- Model manifests with source, license, hash when possible.
- Dependency review.

## Threats to document

- XSS.
- Compromised model manifest.
- Compromised CDN/model source.
- Sensitive data in logs.
- Prompt injection in documents.
- WebGPU crash/device lost.
- Excessive fingerprinting.
- Storage exhaustion.
- Local conversation storage leakage.
- Malicious dependency.

## Local conversation storage

Conversations are sensitive local data. The conversation store must:

- stay browser-local;
- avoid `fetch`, `sendBeacon`, Supabase, Google Drive, and server endpoints;
- avoid local technical logs for message content;
- enforce limits on conversation count, message count, and message size;
- keep schema version metadata for future migrations;
- exclude conversation content from diagnostic reports.

Sprint 5.1 test coverage includes the real IndexedDB store through `fake-indexeddb`, no-IndexedDB memory fallback, active conversation ID pointer behavior, local-log rejection of conversation content fields, diagnostic-report exclusion of conversation-shaped input, and network isolation for conversation-store operations.

## Local conversation export/import

Conversation export files are sensitive local data because they can contain prompts and model responses. The export/import package must:

- stay local-only;
- avoid `fetch`, `sendBeacon`, Supabase, Google Drive, cloud storage, and server endpoints;
- reject unsupported formats and versions;
- reject invalid roles, invalid dates, oversized payloads, and unexpected fields;
- assign fresh conversation IDs during import so existing conversations are not silently overwritten;
- keep exported/imported conversation content out of local technical logs and diagnostic reports.

The current export format is unencrypted JSON. Users should treat exported files as private data until encrypted export is implemented.

The `/chat` export/import UI enforces this at the app layer too: it calls only `conversation-export`/`conversation-store` public functions, never `fetch`, `sendBeacon`, a server endpoint, `logEvent`, local technical logs, or diagnostic reports, and it always imports conversations under fresh IDs rather than overwriting existing ones.

## Generation safety

The WebLLM runtime includes alpha safeguards for unstable model output:

- bounded `max_tokens` for generation requests;
- maximum generation duration;
- output character limits;
- detection for long unbroken sequences, repeated characters, and repeated punctuation/symbol blocks;
- technical-only events such as `inference.degenerate-output` and `inference.generation-timeout`.

When these safeguards fire, partial assistant output is not stored as a completed assistant message. Technical events, local logs, and diagnostic reports must contain only technical metadata such as error codes, runtime status, lengths where applicable, and timing metrics, never prompt or generated response text.

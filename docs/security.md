# Security design

## Security principles

- Privacy-first.
- Secure-by-default.
- Observable-by-design.
- Minimal server data.
- Explicit user control.

## Required protections

- Strict CSP.
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

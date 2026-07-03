# Codex task — telemetry schema and API validation

## Objective

Strengthen telemetry schema and server validation.

## Requirements

- Define strict Zod schema for telemetry events.
- Reject unknown fields.
- Require `contentLogged: false`.
- Reject prompt/response/document fields.
- Add server-side redaction before validation or before persistence.
- Add tests for malicious payloads.
- Add docs/telemetry.md updates.

## Do not implement

- Full Supabase dashboard.
- User analytics.
- Prompt logging.

## Definition of done

- API rejects forbidden fields.
- Tests cover invalid/malicious payloads.
- Docs updated.

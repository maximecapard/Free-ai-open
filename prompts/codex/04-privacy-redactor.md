# Codex task — privacy redactor

## Objective

Build a strong `packages/privacy-redactor` module with tests.

## Requirements

The redactor must remove or mask:

- email addresses;
- phone numbers if feasible;
- API keys;
- JWTs;
- access tokens;
- refresh tokens;
- forbidden fields such as prompt, response, messages, documentContent, chatHistory;
- overly long strings.

## Test requirements

Add tests proving that telemetry payloads cannot contain:

- prompt text;
- response text;
- document text;
- API keys;
- JWTs;
- emails.

## Definition of done

- Redactor is recursive.
- Forbidden fields are removed or replaced.
- Tests pass.
- No sensitive examples remain unredacted in snapshots.

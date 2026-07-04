# ADR 0002 - Store only technical local logs and diagnostic reports

## Status

Accepted

## Context

Local browser inference can fail for reasons that are hard to reproduce: WebGPU availability, model load failures, memory pressure, cancellation timing, and browser-specific worker behavior.

The project needs useful diagnostics without weakening the privacy model. Logs and diagnostic exports must not include prompts, model responses, uploaded documents, conversations, messages, user text, input text, output text, chat history, secrets, or local file paths.

## Decision

Store local diagnostics as technical records only.

Local logs and diagnostic reports must pass through privacy redaction and strict allowlists. They may include technical fields such as event name, severity, timestamp, backend, runtime status, model ID, error code, device tier, performance mode, task category, and coarse performance metrics.

Diagnostic reports must explicitly set `contentLogged: false`.

## Consequences

- Debugging is possible without storing user content.
- The debug dashboard can export useful local reports without adding a server upload path.
- Some debugging detail is intentionally unavailable because content is not logged.
- Any future telemetry or sync feature must preserve this boundary or introduce a new reviewed ADR.

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
- Malicious dependency.

# Telemetry design

## Purpose

Telemetry exists only to debug compatibility, runtime failures, model loading issues, and security events.

It must not collect conversation content.

## Three levels

### Level 1 — Local logs

Stored in the browser. Detailed technical logs. Not sent automatically in full.

### Level 2 — Automatic error telemetry

Redacted technical events sent to the server when important failures happen.

### Level 3 — Voluntary debug report

User exports a redacted report and can review before sending.

## Allowed fields

- event
- severity
- appVersion
- backend
- browserFamily
- osFamily
- deviceTier
- performanceMode
- task
- modelId
- errorCode
- loadTimeMs
- firstTokenMs
- tokensPerSecond
- fallbackAttempted
- fallbackResult
- promptLength
- responseLength
- contentLogged: false

## Forbidden fields

- prompt
- response
- messages
- documentContent
- chatHistory
- apiKey
- accessToken
- localFilePath

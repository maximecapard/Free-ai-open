# Security policy

FreeAI Open is an alpha-stage, local-first browser AI assistant. This document explains how to report a security or privacy issue, and what kinds of issues are in scope.

## Reporting a vulnerability

Please do not open a public GitHub issue with exploit details or a full write-up for a sensitive vulnerability.

Preferred options, in order:

1. If GitHub's private vulnerability reporting is enabled for this repository, use the "Report a vulnerability" option under the repository's Security tab.
2. Otherwise, open an issue using the "Privacy/security report" template with the minimum detail needed to identify the area of concern (for example, "diagnostic report export includes a field that looks like conversation content"), and note that you have more detail available privately. A maintainer will follow up to get the full report through a private channel.

This project does not yet have a dedicated security contact email; that will be added here once available. Do not rely on an email address for this project unless it appears in this file.

Please give maintainers reasonable time to investigate and fix a confirmed issue before any public disclosure of exploit details.

## What is in scope

Given FreeAI Open's local-first privacy model, the following are the most relevant classes of issue:

- **Prompt/response leakage** — any path where a user's prompt or the model's response is sent to the server, logged outside the browser, or otherwise leaves the device unexpectedly.
- **Diagnostic report content leakage** — the `/debug` diagnostic report exporting prompt, response, document, conversation, or message content instead of technical metadata only.
- **Local storage privacy issues** — conversation data in IndexedDB (or the in-memory fallback) being exposed, mixed between conversations, or persisted somewhere it should not be.
- **Unsafe import/export handling** — if/when conversation import/export ships, unsafe parsing or handling of imported data.
- **Unexpected server transmission** — any `fetch`, `sendBeacon`, or server endpoint call carrying content that should stay local, or a new network path added without going through privacy redaction.
- **Dependency/runtime risks** — vulnerable dependencies, unsafe use of `eval`, or WebGPU/WebLLM/worker boundary issues that could lead to code execution or data exposure.

## What is generally out of scope

- Missing features (see [`README.md`](README.md) and [`docs/roadmap.md`](docs/roadmap.md) for current scope) — please file these as a feature request instead.
- Issues that only reproduce with a manually misconfigured deployment (for example, a self-hosted instance with secrets committed to a public fork) rather than the project as shipped.

## Current security posture

FreeAI Open is alpha software. Known, intentional limitations that are not considered vulnerabilities in themselves:

- Local storage (IndexedDB) is not encrypted; clearing browser site data or gaining local device access can expose locally stored conversations and logs, same as any other browser-local storage.
- CSP and other hardening described in [`docs/security.md`](docs/security.md) are still being tightened; see that document and [`docs/roadmap.md`](docs/roadmap.md) for current status.
- Cloud sync, encrypted export/import, and account systems are not implemented yet, so their specific risks do not currently apply.

See [`docs/privacy.md`](docs/privacy.md) and [`docs/security.md`](docs/security.md) for the full privacy and security design.

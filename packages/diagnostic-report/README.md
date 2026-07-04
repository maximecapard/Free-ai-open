# @free-ai-open/diagnostic-report

Builds local-only technical diagnostic reports that can be copied or exported by the browser app.

The report is intentionally limited to technical fields such as app version, runtime status, backend, WebGPU availability, device tier, selected task, model IDs, cache state, recent technical errors, redacted local logs, and performance metrics.

Inputs are passed through `@free-ai-open/privacy-redactor` and then reduced to a strict allowlist. The report must always contain `contentLogged: false` and must not contain prompts, responses, documents, conversations, messages, user text, input text, output text, or chat history.

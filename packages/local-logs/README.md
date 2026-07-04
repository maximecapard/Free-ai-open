# @free-ai-open/local-logs

Local-only structured technical logs for browser runtime diagnostics.

The package stores logs in IndexedDB when the browser API is available. If IndexedDB is unavailable or storage fails, public functions return safe fallback values and do not throw into the app.

Stored fields are intentionally limited to technical diagnostics:

- `event`
- `severity`
- `timestamp`
- `modelId`
- `backend`
- `runtimeStatus`
- `errorCode`
- `deviceTier`
- `performanceMetrics`

Inputs pass through `@free-ai-open/privacy-redactor` before storage and are then reduced to the allowed technical fields. Prompt text, model responses, messages, conversations, documents, file content, user text, input text, output text, and chat history are not stored.

# Privacy policy design

## Main promise

FreeAI Open does not see your conversations.

Your prompts, AI responses, uploaded documents, and chat history stay on your device by default.

## What never leaves the browser by default

- prompts
- model responses
- documents
- extracted document text
- conversation history
- locally stored conversations
- local files
- private notes
- API keys

## What may be sent

Only redacted technical telemetry:

- error codes
- selected model ID
- backend
- performance mode
- task category
- app version
- approximate browser/OS family
- device tier
- performance metrics

## User controls

Users should be able to:

- disable telemetry;
- view the last data sent;
- export debug logs;
- erase local logs;
- erase local conversations;
- erase model cache;
- export/import local conversations;
- enable encrypted Drive sync later.

Implemented today: erase local conversations (delete from the `/chat` history sidebar), erase/view/export local logs and the diagnostic report (`/debug`), and core local JSON conversation export/import helpers. An end-user conversation import/export UI, a telemetry on/off toggle, erasing the model cache, encrypted export, and encrypted Drive sync are not implemented yet — see [`docs/roadmap.md`](roadmap.md).

## Local conversations

Conversation persistence is local-only. Stored conversations may contain user prompts and assistant responses, so they must not be sent to telemetry, diagnostic reports, Supabase, Google Drive, or any server endpoint by default.

The conversation store uses IndexedDB when available and an in-memory fallback when IndexedDB is unavailable. The fallback is temporary and disappears when the page session ends.

Sprint 5.1 adds unit coverage for the IndexedDB store, no-IndexedDB memory fallback, active conversation ID pointer, local-log rejection of conversation content fields, diagnostic-report exclusion of conversation-shaped input, and absence of `fetch`/`sendBeacon` paths in the conversation store.

## Local conversation export/import

The core export/import format is a local JSON file with `format: "freeai-open-conversations"` and `version: 1`. Export files may contain prompts and model responses because their purpose is user-controlled local backup. They must not be sent to telemetry, local technical logs, diagnostic reports, Supabase, Google Drive, or any server endpoint by default.

Imports are validated strictly before use. Imported conversations receive new local conversation IDs by default so an import cannot silently overwrite an existing conversation. The export format is not encrypted; encrypted backup is future work.

The `/chat` history sidebar exposes this as "Export current", "Export all", and "Import" actions. Export downloads a JSON file directly in the browser (no server involved); import reads the file locally, validates it, and shows a summary of what was imported or skipped. The UI displays a persistent reminder that exported files contain conversation text, are not encrypted, and are the user's responsibility once downloaded.

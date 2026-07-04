# @free-ai-open/conversation-store

Local-only browser conversation storage for FreeAI Open.

Conversations are private application data. They are stored in IndexedDB when available and fall back to in-memory storage when IndexedDB is unavailable. This package does not import telemetry, local logs, fetch, sendBeacon, Supabase, Google Drive, or any server transport.

Limits are enforced to avoid unbounded local growth:

- maximum conversations;
- maximum messages per conversation;
- maximum message size;
- maximum title size.

Conversation content is intentionally not redacted inside this package because the purpose of the package is to preserve local conversation text. That content must never be sent to server telemetry or diagnostic reports.

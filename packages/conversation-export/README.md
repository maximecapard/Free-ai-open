# @free-ai-open/conversation-export

Versioned local JSON export/import helpers for FreeAI Open conversations.

This package is intentionally pure TypeScript. It does not read or write IndexedDB, call telemetry, write local logs, call `fetch`, call `sendBeacon`, use Supabase, use Google Drive, or create any server transport.

The exported JSON may contain prompts and model responses because its purpose is local user-controlled conversation backup. Diagnostic reports and local technical logs must never include this data.

Exports are **not encrypted**. Encrypted backup and cloud sync remain future work.

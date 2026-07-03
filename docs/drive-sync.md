# Future Google Drive sync

## Goal

Prevent users from losing conversations when browser cache/site data is cleared.

## MVP alternative

Before Drive sync:

- local IndexedDB history;
- manual export;
- manual import;
- encrypted `.freeai` file.

## Future Drive sync design

Conversations should be encrypted client-side before being written to Google Drive.

```txt
conversation data
→ local encryption
→ encrypted file
→ user's Google Drive
```

The FreeAI Open server must never receive the plaintext conversation.

## Files

Possible Drive files:

- `freeai-conversations.enc`
- `freeai-settings.enc`
- `freeai-index.enc`

## Requirements

- Optional feature.
- Minimal OAuth scopes.
- Clear user consent.
- Manual disconnect.
- Local-first still works without login.

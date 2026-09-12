export const CONVERSATION_EXPORT_FORMAT = "freeai-open-conversations";
export const CONVERSATION_EXPORT_VERSION = 1;
export const CONVERSATION_EXPORT_SOURCE = "freeai-open";

// Matches @free-ai-open/conversation-store's own MAX_MESSAGE_LENGTH exactly
// (see client.ts) and the same derivation: ai-runtime's per-generation
// safety ceiling (12,000 characters) x up to 4 attempts (1 initial reply + 3
// manual continuations) = 48,000 characters worst case; 64,000 leaves real
// margin above that. A stored message that legitimately reaches this size
// must still export/import successfully rather than being silently
// rejected or clipped.
export const DEFAULT_CONVERSATION_EXPORT_LIMITS = {
  maxJsonSize: 5_000_000,
  maxConversations: 100,
  maxMessagesPerConversation: 500,
  maxMessageLength: 64_000,
  maxTitleLength: 120,
  maxIdLength: 200,
} as const;

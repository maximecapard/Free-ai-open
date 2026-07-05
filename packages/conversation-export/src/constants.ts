export const CONVERSATION_EXPORT_FORMAT = "freeai-open-conversations";
export const CONVERSATION_EXPORT_VERSION = 1;
export const CONVERSATION_EXPORT_SOURCE = "freeai-open";

export const DEFAULT_CONVERSATION_EXPORT_LIMITS = {
  maxJsonSize: 5_000_000,
  maxConversations: 100,
  maxMessagesPerConversation: 500,
  maxMessageLength: 16_000,
  maxTitleLength: 120,
  maxIdLength: 200,
} as const;

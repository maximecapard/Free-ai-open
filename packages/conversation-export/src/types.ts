import type { Conversation, ConversationId, MessageRole, MessageStatus } from "@free-ai-open/conversation-store";
import type {
  CONVERSATION_EXPORT_FORMAT,
  CONVERSATION_EXPORT_SOURCE,
  CONVERSATION_EXPORT_VERSION,
} from "./constants";

export interface ConversationExportLimits {
  maxJsonSize: number;
  maxConversations: number;
  maxMessagesPerConversation: number;
  maxMessageLength: number;
  maxTitleLength: number;
  maxIdLength: number;
}

export interface ConversationExportMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: MessageStatus;
}

export interface ConversationExportConversation {
  id: string;
  title: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  messages: ConversationExportMessage[];
  // Optional so exports created before this field existed remain valid
  // imports; older readers of a newer export simply see it as absent too,
  // since it was already rejected as an unexpected field before this change.
  task?: string;
}

export interface ConversationExportData {
  format: typeof CONVERSATION_EXPORT_FORMAT;
  version: typeof CONVERSATION_EXPORT_VERSION;
  exportedAt: string;
  source: typeof CONVERSATION_EXPORT_SOURCE;
  conversations: ConversationExportConversation[];
}

export type ConversationExportValidationResult =
  | { valid: true; data: ConversationExportData }
  | { valid: false; errors: string[] };

export interface ConversationExportOptions {
  now?: () => Date;
  limits?: Partial<ConversationExportLimits>;
}

export interface ParseConversationImportOptions {
  limits?: Partial<ConversationExportLimits>;
}

export type ConversationImportIdPrefix = "conversation" | "message";

export interface PrepareImportedConversationsOptions {
  now?: () => Date;
  idFactory?: (prefix: ConversationImportIdPrefix) => string;
  existingIds?: Iterable<string>;
  limits?: Partial<ConversationExportLimits>;
}

export interface ImportedConversationMetadata {
  source: typeof CONVERSATION_EXPORT_SOURCE;
  originalId: string;
  importedAt: string;
}

export interface PreparedImportedConversation extends Conversation {
  id: ConversationId;
  importMetadata: ImportedConversationMetadata;
}

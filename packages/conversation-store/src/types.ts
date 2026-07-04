export type ConversationId = string & { readonly __brand: "ConversationId" };

export type MessageRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface ConversationMetadata {
  id: ConversationId;
  title: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Conversation extends ConversationMetadata {
  messages: ConversationMessage[];
}

export interface CreateConversationInput {
  id?: ConversationId;
  title?: string;
  createdAt?: string;
}

export interface AddConversationMessageInput {
  id?: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
}

export interface ConversationStoreLimits {
  maxConversations: number;
  maxMessagesPerConversation: number;
  maxMessageLength: number;
  maxTitleLength: number;
}

export interface ConversationStoreClientOptions {
  store?: ConversationStore | null;
  now?: () => Date;
  idFactory?: () => string;
  limits?: Partial<ConversationStoreLimits>;
}

export interface ConversationStore {
  put(conversation: Conversation): Promise<void>;
  get(id: ConversationId): Promise<Conversation | null>;
  getAll(): Promise<Conversation[]>;
  delete(id: ConversationId): Promise<void>;
  clear(): Promise<void>;
}

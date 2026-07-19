export type ConversationId = string & { readonly __brand: "ConversationId" };

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "complete" | "incomplete";

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: MessageStatus;
}

export interface ConversationMetadata {
  id: ConversationId;
  title: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  // The usage/task this conversation was created for (e.g. "chat", "coding").
  // Kept as a plain optional string rather than importing @free-ai-open/types'
  // TaskCategory, so this package stays free of an app-level dependency;
  // callers validate/narrow the value themselves. Absent on conversations
  // created before this field existed — callers must default it (the app
  // layer defaults missing/invalid values to general chat behavior).
  task?: string;
}

export interface Conversation extends ConversationMetadata {
  messages: ConversationMessage[];
}

export interface CreateConversationInput {
  id?: ConversationId;
  title?: string;
  createdAt?: string;
  task?: string;
}

export interface AddConversationMessageInput {
  id?: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
  status?: MessageStatus;
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
  update(
    id: ConversationId,
    updater: (conversation: Conversation) => Conversation | null
  ): Promise<Conversation | null>;
  delete(id: ConversationId): Promise<void>;
  clear(): Promise<void>;
}

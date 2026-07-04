import { createIndexedDbConversationStore } from "./indexed-db-store";
import { createMemoryConversationStore } from "./memory-store";
import type {
  AddConversationMessageInput,
  Conversation,
  ConversationId,
  ConversationMetadata,
  ConversationMessage,
  ConversationStore,
  ConversationStoreClientOptions,
  ConversationStoreLimits,
  CreateConversationInput,
} from "./types";

const SCHEMA_VERSION = 1;

const DEFAULT_LIMITS: ConversationStoreLimits = {
  maxConversations: 100,
  maxMessagesPerConversation: 500,
  maxMessageLength: 16_000,
  maxTitleLength: 120,
};

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toConversationId(value: string): ConversationId {
  return value as ConversationId;
}

function normalizeTitle(title: string | undefined, maxLength: number): string {
  const trimmed = (title ?? "New conversation").trim();
  const safeTitle = trimmed.length > 0 ? trimmed : "New conversation";
  return safeTitle.slice(0, maxLength);
}

function normalizeMessage(input: AddConversationMessageInput, idFactory: () => string, nowIso: string, maxLength: number): ConversationMessage | null {
  if (input.role !== "user" && input.role !== "assistant" && input.role !== "system") return null;
  const content = input.content.slice(0, maxLength);
  if (content.length === 0) return null;

  return {
    id: input.id ?? idFactory(),
    role: input.role,
    content,
    createdAt: input.createdAt ?? nowIso,
  };
}

function byUpdatedDescending(left: ConversationMetadata, right: ConversationMetadata): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function toMetadata(conversation: Conversation): ConversationMetadata {
  return {
    id: conversation.id,
    title: conversation.title,
    schemaVersion: conversation.schemaVersion,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  };
}

function normalizeConversation(conversation: Conversation, limits: ConversationStoreLimits): Conversation {
  const messages = conversation.messages.slice(-limits.maxMessagesPerConversation).map((message) => ({
    ...message,
    content: message.content.slice(0, limits.maxMessageLength),
  }));

  return {
    id: conversation.id,
    title: normalizeTitle(conversation.title, limits.maxTitleLength),
    schemaVersion: conversation.schemaVersion || SCHEMA_VERSION,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: messages.length,
    messages,
  };
}

export class ConversationStoreClient {
  private readonly store: ConversationStore;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly limits: ConversationStoreLimits;

  constructor(options: ConversationStoreClientOptions = {}) {
    this.store = options.store ?? createIndexedDbConversationStore() ?? createMemoryConversationStore();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => createId("conversation"));
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
  }

  async createConversation(input: CreateConversationInput = {}): Promise<Conversation | null> {
    const nowIso = (input.createdAt ? new Date(input.createdAt) : this.now()).toISOString();
    const conversation: Conversation = {
      id: input.id ?? toConversationId(this.idFactory()),
      title: normalizeTitle(input.title, this.limits.maxTitleLength),
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIso,
      updatedAt: nowIso,
      messageCount: 0,
      messages: [],
    };

    try {
      await this.store.put(conversation);
      await this.pruneConversations();
      return conversation;
    } catch {
      return null;
    }
  }

  async getConversation(id: ConversationId): Promise<Conversation | null> {
    try {
      const conversation = await this.store.get(id);
      return conversation ? normalizeConversation(conversation, this.limits) : null;
    } catch {
      return null;
    }
  }

  async listConversations(): Promise<ConversationMetadata[]> {
    try {
      return (await this.store.getAll()).map((conversation) => toMetadata(normalizeConversation(conversation, this.limits))).sort(byUpdatedDescending);
    } catch {
      return [];
    }
  }

  async getRecentConversations(limit = 10): Promise<ConversationMetadata[]> {
    if (!Number.isInteger(limit) || limit <= 0) return [];
    return (await this.listConversations()).slice(0, limit);
  }

  async addMessage(conversationId: ConversationId, input: AddConversationMessageInput): Promise<Conversation | null> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return null;

    const nowIso = this.now().toISOString();
    const message = normalizeMessage(input, () => createId("message"), nowIso, this.limits.maxMessageLength);
    if (!message) return null;

    const messages = [...conversation.messages, message].slice(-this.limits.maxMessagesPerConversation);
    const updated: Conversation = {
      ...conversation,
      updatedAt: nowIso,
      messageCount: messages.length,
      messages,
    };

    try {
      await this.store.put(updated);
      return updated;
    } catch {
      return null;
    }
  }

  async updateConversationTitle(conversationId: ConversationId, title: string): Promise<Conversation | null> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return null;

    const updated: Conversation = {
      ...conversation,
      title: normalizeTitle(title, this.limits.maxTitleLength),
      updatedAt: this.now().toISOString(),
    };

    try {
      await this.store.put(updated);
      return updated;
    } catch {
      return null;
    }
  }

  async deleteConversation(conversationId: ConversationId): Promise<boolean> {
    try {
      await this.store.delete(conversationId);
      return true;
    } catch {
      return false;
    }
  }

  async clearAllConversations(): Promise<void> {
    try {
      await this.store.clear();
    } catch {
      return;
    }
  }

  private async pruneConversations(): Promise<void> {
    const conversations = (await this.store.getAll()).sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
    const excessCount = Math.max(0, conversations.length - this.limits.maxConversations);
    const idsToDelete = conversations.slice(0, excessCount).map((conversation) => conversation.id);

    await Promise.all(idsToDelete.map((id) => this.store.delete(id)));
  }
}

const defaultClient = new ConversationStoreClient();

export function createConversationStoreClient(options: ConversationStoreClientOptions = {}): ConversationStoreClient {
  return new ConversationStoreClient(options);
}

export function createConversation(input: CreateConversationInput = {}): Promise<Conversation | null> {
  return defaultClient.createConversation(input);
}

export function getConversation(id: ConversationId): Promise<Conversation | null> {
  return defaultClient.getConversation(id);
}

export function listConversations(): Promise<ConversationMetadata[]> {
  return defaultClient.listConversations();
}

export function addMessage(conversationId: ConversationId, message: AddConversationMessageInput): Promise<Conversation | null> {
  return defaultClient.addMessage(conversationId, message);
}

export function updateConversationTitle(conversationId: ConversationId, title: string): Promise<Conversation | null> {
  return defaultClient.updateConversationTitle(conversationId, title);
}

export function deleteConversation(conversationId: ConversationId): Promise<boolean> {
  return defaultClient.deleteConversation(conversationId);
}

export function clearAllConversations(): Promise<void> {
  return defaultClient.clearAllConversations();
}

export function getRecentConversations(limit?: number): Promise<ConversationMetadata[]> {
  return defaultClient.getRecentConversations(limit);
}

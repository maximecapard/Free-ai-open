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
  ConversationWriteResult,
  CreateConversationInput,
  MessageIncompleteReason,
  MessageStatus,
  UpdateMessageContentInput,
} from "./types";

const SCHEMA_VERSION = 1;

// ai-runtime's GENERATION_SAFETY_LIMITS.maxOutputCharacters (12,000) bounds
// any SINGLE generation attempt's raw output, and AppRuntimeProvider.tsx's
// MAX_CONTINUATIONS_PER_MESSAGE (3) bounds how many manual continuations one
// message can receive -- so a fully-continued message's worst-case content
// is at most 4 x 12,000 = 48,000 characters (1 initial reply + 3
// continuations). 64,000 leaves real margin above that documented worst
// case, rather than being an arbitrary round number picked without
// reference to what the product actually needs to store. A message that
// somehow still exceeds this is truncated (see normalizeMessage()/
// sanitizeMessageFields()) and FORCED to status: "incomplete" with
// incompleteReason: "truncated" -- never silently accepted as complete.
const MAX_MESSAGE_LENGTH = 64_000;

const DEFAULT_LIMITS: ConversationStoreLimits = {
  maxConversations: 100,
  maxMessagesPerConversation: 500,
  maxMessageLength: MAX_MESSAGE_LENGTH,
  maxTitleLength: 120,
};

const VALID_INCOMPLETE_REASONS = new Set<MessageIncompleteReason>([
  "length",
  "unsupported_tool_call",
  "unknown_terminal",
  "stalled",
  "safety_limit",
  "truncated",
]);

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

function sanitizeStatus(value: unknown): MessageStatus | undefined {
  return value === "complete" || value === "incomplete" ? value : undefined;
}

function sanitizeIncompleteReason(value: unknown): MessageIncompleteReason | undefined {
  return typeof value === "string" && VALID_INCOMPLETE_REASONS.has(value as MessageIncompleteReason)
    ? (value as MessageIncompleteReason)
    : undefined;
}

function sanitizeContinuationCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function clampMessageContent(content: string, maxLength: number): { content: string; truncated: boolean } {
  if (content.length <= maxLength) return { content, truncated: false };
  return { content: content.slice(0, maxLength), truncated: true };
}

interface SanitizedMessageFields {
  content: string;
  status?: MessageStatus;
  incompleteReason?: MessageIncompleteReason;
  continuationCount?: number;
  truncated: boolean;
}

// The single place both the write path (normalizeMessage) and the
// defensive read/update-time re-validation path (normalizeConversation)
// apply the storage ceiling and re-validate status/incompleteReason/
// continuationCount for one message. A message forced to truncate here is
// ALWAYS marked incomplete/"truncated", regardless of what it claimed
// before or what a caller asked for -- persistence can never silently claim
// completeness it cannot back up. See MAX_MESSAGE_LENGTH's derivation above.
function sanitizeMessageFields(
  fields: { content: string; status?: unknown; incompleteReason?: unknown; continuationCount?: unknown },
  maxLength: number
): SanitizedMessageFields {
  const { content, truncated } = clampMessageContent(fields.content, maxLength);
  const status = truncated ? "incomplete" : sanitizeStatus(fields.status);
  const incompleteReason = truncated ? "truncated" : sanitizeIncompleteReason(fields.incompleteReason);
  const continuationCount = sanitizeContinuationCount(fields.continuationCount);
  return { content, status, incompleteReason, continuationCount, truncated };
}

function withOptionalFields(sanitized: SanitizedMessageFields): Partial<ConversationMessage> {
  return {
    ...(sanitized.status !== undefined ? { status: sanitized.status } : {}),
    ...(sanitized.incompleteReason !== undefined ? { incompleteReason: sanitized.incompleteReason } : {}),
    ...(sanitized.continuationCount !== undefined ? { continuationCount: sanitized.continuationCount } : {}),
  };
}

function normalizeMessage(
  input: AddConversationMessageInput,
  idFactory: () => string,
  nowIso: string,
  maxLength: number
): { message: ConversationMessage; truncated: boolean } | null {
  if (input.role !== "user" && input.role !== "assistant" && input.role !== "system") return null;
  if (input.status !== undefined && input.status !== "complete" && input.status !== "incomplete") return null;

  const sanitized = sanitizeMessageFields(
    {
      content: input.content,
      status: input.status,
      incompleteReason: input.incompleteReason,
      continuationCount: input.continuationCount,
    },
    maxLength
  );
  if (sanitized.content.length === 0) return null;

  return {
    message: {
      id: input.id ?? idFactory(),
      role: input.role,
      content: sanitized.content,
      createdAt: input.createdAt ?? nowIso,
      ...withOptionalFields(sanitized),
    },
    truncated: sanitized.truncated,
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
    task: conversation.task,
  };
}

function normalizeConversation(conversation: Conversation, limits: ConversationStoreLimits): Conversation {
  const messages = conversation.messages.slice(-limits.maxMessagesPerConversation).map((message) => {
    const sanitized = sanitizeMessageFields(message, limits.maxMessageLength);
    return {
      id: message.id,
      role: message.role,
      content: sanitized.content,
      createdAt: message.createdAt,
      ...withOptionalFields(sanitized),
    };
  });

  return {
    id: conversation.id,
    title: normalizeTitle(conversation.title, limits.maxTitleLength),
    schemaVersion: conversation.schemaVersion || SCHEMA_VERSION,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: messages.length,
    messages,
    task: conversation.task,
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
      task: input.task,
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

  async addMessage(conversationId: ConversationId, input: AddConversationMessageInput): Promise<ConversationWriteResult | null> {
    const nowIso = this.now().toISOString();
    const prepared = normalizeMessage(input, () => createId("message"), nowIso, this.limits.maxMessageLength);
    if (!prepared) return null;
    const { message, truncated } = prepared;

    try {
      const updated = await this.store.update(conversationId, (storedConversation) => {
        const conversation = normalizeConversation(storedConversation, this.limits);
        const messages = [...conversation.messages, message].slice(-this.limits.maxMessagesPerConversation);
        return {
          ...conversation,
          updatedAt: nowIso,
          messageCount: messages.length,
          messages,
        };
      });
      return updated ? { conversation: normalizeConversation(updated, this.limits), truncated } : null;
    } catch {
      return null;
    }
  }

  // Replaces one existing message's content/status in place (used by the
  // Continue action to extend a truncated assistant reply -- see
  // AppRuntimeProvider.tsx -- rather than appending a new duplicate message,
  // which addMessage() always does). A no-op (returns null) if messageId is
  // not found, so callers cannot accidentally create a new message through
  // this path. status/continuationCount the caller omits are left exactly
  // as they already were on the stored message. incompleteReason has
  // three-way patch semantics (see UpdateMessageContentInput's doc comment):
  // omitted leaves it unchanged, a valid reason sets it, and `null`
  // explicitly clears it -- needed because a successful Continue must end
  // up with NO incompleteReason at all, not whatever stale ambiguous-
  // terminal reason the message had before the continuation started. An
  // actual truncation performed by this call always wins over all of this.
  async updateMessageContent(
    conversationId: ConversationId,
    messageId: string,
    update: UpdateMessageContentInput
  ): Promise<ConversationWriteResult | null> {
    const { content, truncated } = clampMessageContent(update.content, this.limits.maxMessageLength);
    if (content.length === 0) return null;

    try {
      const updated = await this.store.update(conversationId, (storedConversation) => {
        const conversation = normalizeConversation(storedConversation, this.limits);
        const messages = conversation.messages.map((message) => {
          if (message.id !== messageId) return message;

          const status = truncated ? "incomplete" : (update.status ?? message.status);
          const incompleteReason = truncated
            ? "truncated"
            : update.incompleteReason === null
              ? undefined
              : (update.incompleteReason ?? message.incompleteReason);
          const continuationCount = update.continuationCount ?? message.continuationCount;

          // Rebuilt field-by-field rather than `{ ...message, ... }`: a
          // spread would carry the OLD incompleteReason key forward even
          // when the computed value above is `undefined` (the explicit-
          // clear case), since spreading an existing key and then
          // conditionally omitting a replacement does not delete it.
          return {
            id: message.id,
            role: message.role,
            content,
            createdAt: message.createdAt,
            ...(status !== undefined ? { status } : {}),
            ...(incompleteReason !== undefined ? { incompleteReason } : {}),
            ...(continuationCount !== undefined ? { continuationCount } : {}),
          };
        });
        return {
          ...conversation,
          updatedAt: this.now().toISOString(),
          messageCount: messages.length,
          messages,
        };
      });
      return updated ? { conversation: normalizeConversation(updated, this.limits), truncated } : null;
    } catch {
      return null;
    }
  }

  async updateConversationTitle(conversationId: ConversationId, title: string): Promise<Conversation | null> {
    try {
      const updated = await this.store.update(conversationId, (storedConversation) => ({
        ...normalizeConversation(storedConversation, this.limits),
        title: normalizeTitle(title, this.limits.maxTitleLength),
        updatedAt: this.now().toISOString(),
      }));
      return updated ? normalizeConversation(updated, this.limits) : null;
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

export function addMessage(conversationId: ConversationId, message: AddConversationMessageInput): Promise<ConversationWriteResult | null> {
  return defaultClient.addMessage(conversationId, message);
}

export function updateConversationTitle(conversationId: ConversationId, title: string): Promise<Conversation | null> {
  return defaultClient.updateConversationTitle(conversationId, title);
}

export function updateMessageContent(
  conversationId: ConversationId,
  messageId: string,
  update: UpdateMessageContentInput
): Promise<ConversationWriteResult | null> {
  return defaultClient.updateMessageContent(conversationId, messageId, update);
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

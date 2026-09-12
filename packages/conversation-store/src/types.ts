export type ConversationId = string & { readonly __brand: "ConversationId" };

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "complete" | "incomplete";

// Distinguishes WHY an assistant message is incomplete, for messages
// persisted since this field was added (v0.7.1-alpha reasoning/finish-reason
// hotfix -- see docs/architecture.md). Optional and purely additive: a
// message from before this field existed simply has status: "incomplete"
// with no reason, and still renders/continues correctly through the generic
// notice -- callers must never assume this field is present.
//
// - "length": WebLLM's own finish_reason "length" -- the output-token
//   budget was exhausted before a natural stop.
// - "unsupported_tool_call": WebLLM's own finish_reason "tool_calls" -- a
//   response shape FreeAI Open does not support, never model instability.
// - "unknown_terminal": the generation stream ended without any explicit
//   finish_reason at all -- failed closed rather than assumed successful.
// - "stalled": the generation watchdog forced recovery after a genuine gap
//   in progress.
// - "safety_limit": the absolute emergency duration cap was reached.
// - "truncated": this store's own maxMessageLength ceiling was reached
//   while saving -- see client.ts's normalizeMessage().
export type MessageIncompleteReason =
  | "length"
  | "unsupported_tool_call"
  | "unknown_terminal"
  | "stalled"
  | "safety_limit"
  | "truncated";

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: MessageStatus;
  incompleteReason?: MessageIncompleteReason;
  // How many times this message has already been extended through the
  // manual Continue action (see AppRuntimeProvider.tsx's continueGeneration
  // and MAX_CONTINUATIONS_PER_MESSAGE). Persisted rather than kept only in
  // memory so a page refresh cannot reset the continuation bound.
  continuationCount?: number;
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
  incompleteReason?: MessageIncompleteReason;
  continuationCount?: number;
}

// Result of a write that may have needed to enforce this store's own
// maxMessageLength ceiling. `truncated: true` means the caller's content was
// cut short and the message was FORCED to status: "incomplete" (with
// incompleteReason: "truncated") regardless of what the caller asked for --
// see client.ts's normalizeMessage(). A caller that ignores this flag still
// gets a durably-marked-incomplete message rather than one silently missing
// content while claiming to be complete.
export interface ConversationWriteResult {
  conversation: Conversation;
  truncated: boolean;
}

// updateMessageContent()'s patch semantics for a field that must be able to
// distinguish "leave exactly as it is" from "remove it" -- plain optional
// (`| undefined`) can only ever mean "unspecified", which cannot express
// clearing a previously-set value. Concretely: a message that finishes a
// successful Continue must end up with NO incompleteReason at all, not
// whatever ambiguous-terminal reason it had before the continuation started
// -- see client.ts's updateMessageContent().
//   - omitted / undefined -> leave the stored value unchanged
//   - a valid MessageIncompleteReason -> set it to that value
//   - null -> explicitly clear the stored value
export interface UpdateMessageContentInput {
  content: string;
  status?: MessageStatus;
  incompleteReason?: MessageIncompleteReason | null;
  continuationCount?: number;
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

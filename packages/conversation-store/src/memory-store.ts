import type { Conversation, ConversationId, ConversationStore } from "./types";

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  };
}

export function createMemoryConversationStore(): ConversationStore {
  const records = new Map<ConversationId, Conversation>();

  return {
    async put(conversation) {
      records.set(conversation.id, cloneConversation(conversation));
    },
    async get(id) {
      const conversation = records.get(id);
      return conversation ? cloneConversation(conversation) : null;
    },
    async getAll() {
      return [...records.values()].map(cloneConversation);
    },
    async update(id, updater) {
      const current = records.get(id);
      if (!current) return null;
      const updated = updater(cloneConversation(current));
      if (!updated) return null;
      records.set(id, cloneConversation(updated));
      return cloneConversation(updated);
    },
    async delete(id) {
      records.delete(id);
    },
    async clear() {
      records.clear();
    },
  };
}

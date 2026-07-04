import type { Conversation } from "@free-ai-open/conversation-store";
import type { ChatMessageItem } from "../_components/ChatTranscript";

export function toChatMessageItems(conversation: Conversation): ChatMessageItem[] {
  const items: ChatMessageItem[] = [];
  for (const message of conversation.messages) {
    if (message.role === "user" || message.role === "assistant") {
      items.push({ id: message.id, role: message.role, content: message.content });
    }
  }
  return items;
}

export function deriveConversationTitle(prompt: string, maxLength = 60): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

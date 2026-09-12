import type { Conversation } from "@free-ai-open/conversation-store";
import type { ChatMessageItem } from "../_components/ChatTranscript";

export function toChatMessageItems(conversation: Conversation): ChatMessageItem[] {
  const items: ChatMessageItem[] = [];
  for (const message of conversation.messages) {
    if (message.role === "user" || message.role === "assistant") {
      items.push({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        // Durable -- unlike a session-only flag, this survives reload/
        // export/import, so a length-limited reply still shows its specific
        // notice after the page refreshes (see ChatTranscript.tsx). Absent
        // for a message persisted before this field existed.
        incompleteReason: message.incompleteReason,
        continuationCount: message.continuationCount,
      });
    }
  }
  return items;
}

export function deriveConversationTitle(prompt: string, maxLength = 60): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

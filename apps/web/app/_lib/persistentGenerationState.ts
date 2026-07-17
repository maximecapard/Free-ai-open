import type { ConversationId } from "@free-ai-open/conversation-store";
import type { ChatMessageItem } from "../_components/ChatTranscript";

export interface ActiveGenerationDescriptor {
  generationId: string;
  conversationId: ConversationId;
  assistantMessageId: string;
}

export function isGenerationCurrent(
  activeGeneration: ActiveGenerationDescriptor | null,
  generationId: string,
  conversationId: ConversationId
): boolean {
  return activeGeneration?.generationId === generationId && activeGeneration.conversationId === conversationId;
}

export function appendAssistantChunk(
  messages: readonly ChatMessageItem[],
  activeGeneration: ActiveGenerationDescriptor | null,
  generationId: string,
  conversationId: ConversationId,
  assistantMessageId: string,
  text: string
): ChatMessageItem[] {
  if (!isGenerationCurrent(activeGeneration, generationId, conversationId)) return [...messages];

  return messages.map((message) =>
    message.id === assistantMessageId ? { ...message, content: message.content + text } : message
  );
}

export function removeAssistantMessage(
  messages: readonly ChatMessageItem[],
  assistantMessageId: string
): ChatMessageItem[] {
  return messages.filter((message) => message.id !== assistantMessageId);
}

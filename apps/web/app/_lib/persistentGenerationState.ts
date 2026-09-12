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

// Sets an assistant message's content to an exact, already-computed string
// -- a full replace, not an append. The caller (AppRuntimeProvider.tsx) is
// the single source of truth for what that string should be: a runtime-side
// generation accumulator, updated synchronously from each raw chunk before
// any buffered UI rendering, whose value already has continuation overlap
// removed (see continuationMerge.ts). This function's only job is applying
// that already-correct value to React state without re-deriving it from
// what happens to be rendered yet -- see docs/architecture.md's "Generation
// output is independent from queued React state" section.
export function setAssistantContent(
  messages: readonly ChatMessageItem[],
  activeGeneration: ActiveGenerationDescriptor | null,
  generationId: string,
  conversationId: ConversationId,
  assistantMessageId: string,
  content: string
): ChatMessageItem[] {
  if (!isGenerationCurrent(activeGeneration, generationId, conversationId)) return [...messages];

  return messages.map((message) => (message.id === assistantMessageId ? { ...message, content } : message));
}

export function removeAssistantMessage(
  messages: readonly ChatMessageItem[],
  assistantMessageId: string
): ChatMessageItem[] {
  return messages.filter((message) => message.id !== assistantMessageId);
}

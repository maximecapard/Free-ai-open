import type { RuntimeStatus } from "@free-ai-open/ai-runtime";

export function isConversationSwitchBlockedStatus(status: RuntimeStatus): boolean {
  return status === "generating" || status === "cancelling" || status === "recovering";
}

export function canSendChatMessage(status: RuntimeStatus, draft: string): boolean {
  return status === "ready" && draft.trim().length > 0;
}

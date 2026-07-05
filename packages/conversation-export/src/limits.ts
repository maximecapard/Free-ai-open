import { DEFAULT_CONVERSATION_EXPORT_LIMITS } from "./constants";
import type { ConversationExportLimits } from "./types";

export function resolveConversationExportLimits(limits: Partial<ConversationExportLimits> = {}): ConversationExportLimits {
  return { ...DEFAULT_CONVERSATION_EXPORT_LIMITS, ...limits };
}

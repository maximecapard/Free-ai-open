import type { ConversationId } from "@free-ai-open/conversation-store";
import type { ConversationImportIdPrefix } from "./types";

function fallbackId(prefix: ConversationImportIdPrefix): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDefaultImportId(prefix: ConversationImportIdPrefix): string {
  const randomUUID = globalThis.crypto && "randomUUID" in globalThis.crypto ? globalThis.crypto.randomUUID.bind(globalThis.crypto) : null;
  return randomUUID ? `${prefix}-${randomUUID()}` : fallbackId(prefix);
}

export function toConversationId(value: string): ConversationId {
  return value as ConversationId;
}

export function createUniqueConversationId(
  idFactory: (prefix: ConversationImportIdPrefix) => string,
  usedIds: Set<string>
): ConversationId {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = idFactory("conversation");
    if (id.length > 0 && !usedIds.has(id)) {
      usedIds.add(id);
      return toConversationId(id);
    }
  }

  throw new Error("Unable to generate a unique imported conversation ID");
}

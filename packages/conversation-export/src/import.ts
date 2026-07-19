import type { ConversationMessage } from "@free-ai-open/conversation-store";
import { ConversationExportError } from "./errors";
import { createDefaultImportId, createUniqueConversationId } from "./ids";
import { resolveConversationExportLimits } from "./limits";
import { validateConversationExport } from "./validation";
import type {
  ConversationExportData,
  ParseConversationImportOptions,
  PreparedImportedConversation,
  PrepareImportedConversationsOptions,
} from "./types";

function assertValidImport(data: unknown, limits: ParseConversationImportOptions["limits"]): ConversationExportData {
  const result = validateConversationExport(data, { limits });
  if (!result.valid) {
    throw new ConversationExportError("Invalid conversation import data", result.errors);
  }

  return result.data;
}

export function parseConversationImport(
  jsonText: string,
  options: ParseConversationImportOptions = {}
): ConversationExportData {
  const limits = resolveConversationExportLimits(options.limits);
  if (jsonText.length > limits.maxJsonSize) {
    throw new ConversationExportError("Conversation import JSON exceeds maximum size");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    throw new ConversationExportError("Conversation import is not valid JSON");
  }

  return assertValidImport(parsed, options.limits);
}

export function prepareImportedConversations(
  exportData: ConversationExportData,
  options: PrepareImportedConversationsOptions = {}
): PreparedImportedConversation[] {
  const validExport = assertValidImport(exportData, options.limits);
  const importedAt = (options.now ?? (() => new Date()))().toISOString();
  const idFactory = options.idFactory ?? createDefaultImportId;
  const usedConversationIds = new Set(options.existingIds ?? []);

  return validExport.conversations.map((conversation): PreparedImportedConversation => {
    const id = createUniqueConversationId(idFactory, usedConversationIds);
    const messages: ConversationMessage[] = conversation.messages.map((message) => ({
      id: idFactory("message"),
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(message.status !== undefined ? { status: message.status } : {}),
    }));

    return {
      id,
      title: conversation.title,
      schemaVersion: conversation.schemaVersion,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: messages.length,
      messages,
      task: conversation.task,
      importMetadata: {
        source: validExport.source,
        originalId: conversation.id,
        importedAt,
      },
    };
  });
}

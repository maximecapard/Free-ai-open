import type { Conversation } from "@free-ai-open/conversation-store";
import {
  CONVERSATION_EXPORT_FORMAT,
  CONVERSATION_EXPORT_SOURCE,
  CONVERSATION_EXPORT_VERSION,
} from "./constants";
import { ConversationExportError } from "./errors";
import { resolveConversationExportLimits } from "./limits";
import { validateConversationExport } from "./validation";
import type { ConversationExportData, ConversationExportOptions } from "./types";

function toExportData(conversations: Conversation[], exportedAt: string): ConversationExportData {
  return {
    format: CONVERSATION_EXPORT_FORMAT,
    version: CONVERSATION_EXPORT_VERSION,
    exportedAt,
    source: CONVERSATION_EXPORT_SOURCE,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      schemaVersion: conversation.schemaVersion,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
      ...(conversation.task ? { task: conversation.task } : {}),
    })),
  };
}

function assertValidExport(data: unknown, options: ConversationExportOptions = {}): asserts data is ConversationExportData {
  const result = validateConversationExport(data, { limits: options.limits });
  if (!result.valid) {
    throw new ConversationExportError("Invalid conversation export data", result.errors);
  }
}

export function buildConversationExport(
  conversations: Conversation[],
  options: ConversationExportOptions = {}
): ConversationExportData {
  const exportedAt = (options.now ?? (() => new Date()))().toISOString();
  const exportData = toExportData(conversations, exportedAt);
  assertValidExport(exportData, options);
  return exportData;
}

export function serializeConversationExport(
  exportData: ConversationExportData,
  options: ConversationExportOptions = {}
): string {
  assertValidExport(exportData, options);

  const json = JSON.stringify(exportData, null, 2);
  const limits = resolveConversationExportLimits(options.limits);
  if (json.length > limits.maxJsonSize) {
    throw new ConversationExportError("Conversation export JSON exceeds maximum size");
  }

  return json;
}

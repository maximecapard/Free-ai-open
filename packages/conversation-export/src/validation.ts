import {
  CONVERSATION_EXPORT_FORMAT,
  CONVERSATION_EXPORT_SOURCE,
  CONVERSATION_EXPORT_VERSION,
} from "./constants";
import { resolveConversationExportLimits } from "./limits";
import type {
  ConversationExportData,
  ConversationExportLimits,
  ConversationExportValidationResult,
} from "./types";

const ROOT_KEYS = new Set(["format", "version", "exportedAt", "source", "conversations"]);
const CONVERSATION_KEYS = new Set(["id", "title", "schemaVersion", "createdAt", "updatedAt", "messages", "task"]);
const MESSAGE_KEYS = new Set(["id", "role", "content", "createdAt"]);
const VALID_ROLES = new Set(["user", "assistant", "system"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return new Date(time).toISOString() === value;
}

function collectUnexpectedKeys(value: Record<string, unknown>, allowedKeys: Set<string>, path: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}.${key}: unexpected field`);
    }
  }
}

function validateBoundedString(
  value: unknown,
  path: string,
  maxLength: number,
  errors: string[],
  options: { allowEmpty?: boolean } = {}
): void {
  if (typeof value !== "string") {
    errors.push(`${path}: must be a string`);
    return;
  }

  if (!options.allowEmpty && value.length === 0) {
    errors.push(`${path}: must not be empty`);
  }

  if (value.length > maxLength) {
    errors.push(`${path}: exceeds maximum length`);
  }
}

function validateExportMessage(
  value: unknown,
  path: string,
  limits: ConversationExportLimits,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`${path}: must be an object`);
    return;
  }

  collectUnexpectedKeys(value, MESSAGE_KEYS, path, errors);
  validateBoundedString(value.id, `${path}.id`, limits.maxIdLength, errors);
  validateBoundedString(value.content, `${path}.content`, limits.maxMessageLength, errors);

  if (typeof value.role !== "string" || !VALID_ROLES.has(value.role)) {
    errors.push(`${path}.role: must be user, assistant, or system`);
  }

  if (!isCanonicalIsoDateTime(value.createdAt)) {
    errors.push(`${path}.createdAt: must be a canonical ISO datetime`);
  }
}

function validateExportConversation(
  value: unknown,
  path: string,
  limits: ConversationExportLimits,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`${path}: must be an object`);
    return;
  }

  collectUnexpectedKeys(value, CONVERSATION_KEYS, path, errors);
  validateBoundedString(value.id, `${path}.id`, limits.maxIdLength, errors);
  validateBoundedString(value.title, `${path}.title`, limits.maxTitleLength, errors);

  if (value.task !== undefined) {
    validateBoundedString(value.task, `${path}.task`, limits.maxTitleLength, errors, { allowEmpty: false });
  }

  if (value.schemaVersion !== 1) {
    errors.push(`${path}.schemaVersion: must be 1`);
  }

  if (!isCanonicalIsoDateTime(value.createdAt)) {
    errors.push(`${path}.createdAt: must be a canonical ISO datetime`);
  }

  if (!isCanonicalIsoDateTime(value.updatedAt)) {
    errors.push(`${path}.updatedAt: must be a canonical ISO datetime`);
  }

  if (!Array.isArray(value.messages)) {
    errors.push(`${path}.messages: must be an array`);
    return;
  }

  if (value.messages.length > limits.maxMessagesPerConversation) {
    errors.push(`${path}.messages: exceeds maximum message count`);
  }

  value.messages.forEach((message, index) => {
    validateExportMessage(message, `${path}.messages[${index}]`, limits, errors);
  });
}

export function validateConversationExport(
  data: unknown,
  options: { limits?: Partial<ConversationExportLimits> } = {}
): ConversationExportValidationResult {
  const limits = resolveConversationExportLimits(options.limits);
  const errors: string[] = [];

  if (!isRecord(data)) {
    return { valid: false, errors: ["export: must be an object"] };
  }

  collectUnexpectedKeys(data, ROOT_KEYS, "export", errors);

  if (data.format !== CONVERSATION_EXPORT_FORMAT) {
    errors.push("export.format: unsupported format");
  }

  if (data.version !== CONVERSATION_EXPORT_VERSION) {
    errors.push("export.version: unsupported version");
  }

  if (data.source !== CONVERSATION_EXPORT_SOURCE) {
    errors.push("export.source: unsupported source");
  }

  if (!isCanonicalIsoDateTime(data.exportedAt)) {
    errors.push("export.exportedAt: must be a canonical ISO datetime");
  }

  if (!Array.isArray(data.conversations)) {
    errors.push("export.conversations: must be an array");
  } else {
    if (data.conversations.length > limits.maxConversations) {
      errors.push("export.conversations: exceeds maximum conversation count");
    }

    data.conversations.forEach((conversation, index) => {
      validateExportConversation(conversation, `export.conversations[${index}]`, limits, errors);
    });
  }

  return errors.length === 0
    ? { valid: true, data: data as unknown as ConversationExportData }
    : { valid: false, errors };
}

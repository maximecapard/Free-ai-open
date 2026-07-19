import { buildDiagnosticReport, validateDiagnosticReportPrivacy } from "@free-ai-open/diagnostic-report";
import { describe, expect, it, vi } from "vitest";
import {
  buildConversationExport,
  ConversationExportError,
  parseConversationImport,
  prepareImportedConversations,
  serializeConversationExport,
  validateConversationExport,
} from "./index";
import type { Conversation, ConversationId } from "@free-ai-open/conversation-store";
import type { DiagnosticReportInput } from "@free-ai-open/diagnostic-report";

const conversationId = "conversation-original" as ConversationId;
const now = () => new Date("2026-07-05T10:00:00.000Z");

const baseConversation: Conversation = {
  id: conversationId,
  title: "Local planning notes",
  schemaVersion: 1,
  createdAt: "2026-07-04T10:00:00.000Z",
  updatedAt: "2026-07-04T10:05:00.000Z",
  messageCount: 2,
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "private prompt to export locally",
      createdAt: "2026-07-04T10:00:00.000Z",
    },
    {
      id: "message-2",
      role: "assistant",
      content: "private response to export locally",
      createdAt: "2026-07-04T10:05:00.000Z",
    },
  ],
};

function validExportJson(): string {
  return serializeConversationExport(buildConversationExport([baseConversation], { now }));
}

describe("conversation export/import", () => {
  it("builds a valid versioned local conversation export", () => {
    const exportData = buildConversationExport([baseConversation], { now });

    expect(exportData).toEqual({
      format: "freeai-open-conversations",
      version: 1,
      exportedAt: "2026-07-05T10:00:00.000Z",
      source: "freeai-open",
      conversations: [
        {
          id: "conversation-original",
          title: "Local planning notes",
          schemaVersion: 1,
          createdAt: "2026-07-04T10:00:00.000Z",
          updatedAt: "2026-07-04T10:05:00.000Z",
          messages: baseConversation.messages,
        },
      ],
    });
    expect(validateConversationExport(exportData)).toEqual({ valid: true, data: exportData });
  });

  it("serializes and parses a valid local import", () => {
    const parsed = parseConversationImport(validExportJson());

    expect(parsed.conversations).toHaveLength(1);
    expect(parsed.conversations[0]?.messages.map((message) => message.content)).toEqual([
      "private prompt to export locally",
      "private response to export locally",
    ]);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseConversationImport("{not valid json")).toThrow(ConversationExportError);
  });

  it("rejects the wrong format", () => {
    const data = JSON.parse(validExportJson()) as Record<string, unknown>;
    data.format = "other-format";

    expect(() => parseConversationImport(JSON.stringify(data))).toThrow(/Invalid conversation import data/);
    expect(validateConversationExport(data)).toMatchObject({ valid: false });
  });

  it("rejects the wrong version", () => {
    const data = JSON.parse(validExportJson()) as Record<string, unknown>;
    data.version = 999;

    expect(() => parseConversationImport(JSON.stringify(data))).toThrow(/Invalid conversation import data/);
  });

  it("rejects invalid message roles", () => {
    const data = JSON.parse(validExportJson()) as {
      conversations: Array<{ messages: Array<{ role: string }> }>;
    };
    data.conversations[0]!.messages[0]!.role = "admin";

    expect(() => parseConversationImport(JSON.stringify(data))).toThrow(/Invalid conversation import data/);
  });

  it("rejects invalid dates", () => {
    const data = JSON.parse(validExportJson()) as {
      conversations: Array<{ createdAt: string }>;
    };
    data.conversations[0]!.createdAt = "2026-07-04";

    expect(() => parseConversationImport(JSON.stringify(data))).toThrow(/Invalid conversation import data/);
  });

  it("rejects oversized messages", () => {
    const data = JSON.parse(validExportJson()) as {
      conversations: Array<{ messages: Array<{ content: string }> }>;
    };
    data.conversations[0]!.messages[0]!.content = "x".repeat(11);

    expect(() => parseConversationImport(JSON.stringify(data), { limits: { maxMessageLength: 10 } })).toThrow(
      /Invalid conversation import data/
    );
  });

  it("rejects oversized imports before parsing", () => {
    expect(() => parseConversationImport(validExportJson(), { limits: { maxJsonSize: 10 } })).toThrow(
      /exceeds maximum size/
    );
  });

  it("rejects unexpected fields", () => {
    const data = JSON.parse(validExportJson()) as Record<string, unknown>;
    data.prompt = "private prompt should not be hidden in an unexpected field";

    const result = validateConversationExport(data);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.errors).toContain("export.prompt: unexpected field");
    }
  });

  it("prepares imported conversations with new IDs and import metadata", () => {
    const parsed = parseConversationImport(validExportJson());
    const ids = ["conversation-existing", "conversation-imported", "message-imported-1", "message-imported-2"];
    const prepared = prepareImportedConversations(parsed, {
      now,
      existingIds: ["conversation-existing"],
      idFactory: () => ids.shift() ?? "fallback-id",
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      id: "conversation-imported",
      title: "Local planning notes",
      createdAt: "2026-07-04T10:00:00.000Z",
      updatedAt: "2026-07-04T10:05:00.000Z",
      messageCount: 2,
      importMetadata: {
        source: "freeai-open",
        originalId: "conversation-original",
        importedAt: "2026-07-05T10:00:00.000Z",
      },
    });
    expect(prepared[0]?.id).not.toBe(baseConversation.id);
    expect(prepared[0]?.messages.map((message) => message.content)).toEqual([
      "private prompt to export locally",
      "private response to export locally",
    ]);
    expect(prepared[0]?.messages.map((message) => message.id)).toEqual(["message-imported-1", "message-imported-2"]);
  });

  it("preserves the task field through a build/parse/prepare round trip", () => {
    const withTask: Conversation = { ...baseConversation, task: "coding" };
    const exportData = buildConversationExport([withTask], { now });

    expect(exportData.conversations[0]?.task).toBe("coding");

    const parsed = parseConversationImport(serializeConversationExport(exportData, { now }));
    expect(parsed.conversations[0]?.task).toBe("coding");

    const prepared = prepareImportedConversations(parsed, { now, idFactory: (prefix) => `${prefix}-with-task` });
    expect(prepared[0]?.task).toBe("coding");
  });

  it("preserves incomplete assistant provenance through export and import", () => {
    const incompleteConversation: Conversation = {
      ...baseConversation,
      messages: baseConversation.messages.map((message, index) =>
        index === 1 ? { ...message, status: "incomplete" as const } : message
      ),
    };

    const exportData = buildConversationExport([incompleteConversation], { now });
    expect(exportData.conversations[0]?.messages[1]?.status).toBe("incomplete");

    const parsed = parseConversationImport(serializeConversationExport(exportData));
    const prepared = prepareImportedConversations(parsed, {
      now,
      idFactory: (prefix) => `${prefix}-incomplete`,
    });

    expect(prepared[0]?.messages[1]?.status).toBe("incomplete");
  });

  it("preserves an explicit completed status when present", () => {
    const completedConversation: Conversation = {
      ...baseConversation,
      messages: baseConversation.messages.map((message, index) =>
        index === 1 ? { ...message, status: "complete" as const } : message
      ),
    };

    const exportData = buildConversationExport([completedConversation], { now });
    expect(exportData.conversations[0]?.messages[1]?.status).toBe("complete");

    const prepared = prepareImportedConversations(exportData, {
      now,
      idFactory: (prefix) => `${prefix}-complete`,
    });

    expect(prepared[0]?.messages[1]?.status).toBe("complete");
  });

  it("rejects unknown message completion statuses", () => {
    const data = JSON.parse(validExportJson()) as {
      conversations: Array<{ messages: Array<Record<string, unknown>> }>;
    };
    data.conversations[0]!.messages[1]!.status = "streaming";

    expect(validateConversationExport(data)).toMatchObject({ valid: false });
    expect(() => parseConversationImport(JSON.stringify(data))).toThrow(/Invalid conversation import data/);
  });

  it("remains a valid, importable export when task is absent (older export format)", () => {
    const exportData = buildConversationExport([baseConversation], { now });
    expect(exportData.conversations[0]?.task).toBeUndefined();
    expect(JSON.stringify(exportData)).not.toContain('"task"');

    const parsed = parseConversationImport(serializeConversationExport(exportData, { now }));
    const prepared = prepareImportedConversations(parsed, { now, idFactory: (prefix) => `${prefix}-no-task` });

    expect(prepared[0]?.task).toBeUndefined();
  });

  it("rejects a task value that is not a bounded string", () => {
    const data = JSON.parse(validExportJson()) as Record<string, unknown>;
    (data.conversations as Array<Record<string, unknown>>)[0]!.task = 12345;

    const result = validateConversationExport(data);
    expect(result).toMatchObject({ valid: false });
  });

  it("does not add any network transport while exporting and importing", () => {
    const fetchSpy = vi.fn();
    const sendBeaconSpy = vi.fn();
    const previousFetch = globalThis.fetch;
    const previousNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchSpy });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: sendBeaconSpy } });

    try {
      const exportData = buildConversationExport([baseConversation], { now });
      const parsed = parseConversationImport(serializeConversationExport(exportData));
      prepareImportedConversations(parsed, { now, idFactory: (prefix) => `${prefix}-local` });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sendBeaconSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: previousFetch });
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
    }
  });

  it("does not make diagnostic reports export conversation import content", () => {
    const exportData = buildConversationExport([baseConversation], { now });
    const report = buildDiagnosticReport(
      {
        conversations: exportData.conversations,
        messages: exportData.conversations[0]?.messages,
      } as unknown as DiagnosticReportInput,
      { now }
    );
    const serialized = JSON.stringify(report);

    expect(report.contentLogged).toBe(false);
    expect(validateDiagnosticReportPrivacy(report)).toEqual({ valid: true, violations: [] });
    expect(serialized).not.toContain("private prompt to export locally");
    expect(serialized).not.toContain("private response to export locally");
    expect(serialized).not.toMatch(/"conversation"|"conversations"|"messages"/);
  });
});

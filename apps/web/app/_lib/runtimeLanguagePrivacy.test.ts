import { describe, expect, it } from "vitest";
import { getRuntimeLanguageInstruction } from "@free-ai-open/ai-runtime";
import { buildConversationExport, serializeConversationExport } from "@free-ai-open/conversation-export";
import type { Conversation, ConversationId } from "@free-ai-open/conversation-store";
import { buildDiagnosticReport, validateDiagnosticReportPrivacy } from "@free-ai-open/diagnostic-report";
import type { DiagnosticReportInput } from "@free-ai-open/diagnostic-report";

const conversation: Conversation = {
  id: "conversation-1" as ConversationId,
  title: "Local chat",
  schemaVersion: 1,
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:01:00.000Z",
  messageCount: 2,
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "Bonjour",
      createdAt: "2026-07-15T10:00:00.000Z",
    },
    {
      id: "message-2",
      role: "assistant",
      content: "Bonjour, comment puis-je aider ?",
      createdAt: "2026-07-15T10:01:00.000Z",
    },
  ],
};

describe("runtime language instruction privacy", () => {
  it("does not export hidden runtime-only language instructions with conversations", () => {
    const json = serializeConversationExport(buildConversationExport([conversation]));

    expect(json).not.toContain(getRuntimeLanguageInstruction("fr"));
    expect(json).not.toContain(getRuntimeLanguageInstruction("en"));
    expect(json).not.toMatch(/"role":"system"/);
  });

  it("does not include hidden language instructions in diagnostic reports", () => {
    const report = buildDiagnosticReport({
      runtimeStatus: "ready",
      prompt: getRuntimeLanguageInstruction("fr"),
      response: getRuntimeLanguageInstruction("en"),
      messages: [{ role: "system", content: getRuntimeLanguageInstruction("fr") }],
      localLogs: [
        {
          id: "log-1",
          event: "inference.started",
          severity: "info",
          timestamp: "2026-07-15T10:00:00.000Z",
          prompt: getRuntimeLanguageInstruction("fr"),
        },
      ],
    } as unknown as DiagnosticReportInput);
    const serialized = JSON.stringify(report);

    expect(report.contentLogged).toBe(false);
    expect(validateDiagnosticReportPrivacy(report)).toEqual({ valid: true, violations: [] });
    expect(serialized).not.toContain(getRuntimeLanguageInstruction("fr"));
    expect(serialized).not.toContain(getRuntimeLanguageInstruction("en"));
    expect(serialized).not.toMatch(/"messages"|"prompt"|"response"/);
  });
});

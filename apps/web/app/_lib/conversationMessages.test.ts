import { describe, expect, it } from "vitest";
import type { Conversation, ConversationId } from "@free-ai-open/conversation-store";
import { toChatMessageItems } from "./conversationMessages";

describe("toChatMessageItems", () => {
  it("preserves incomplete assistant provenance when a conversation is reloaded", () => {
    const conversation: Conversation = {
      id: "conversation-1" as ConversationId,
      title: "Local chat",
      schemaVersion: 1,
      createdAt: "2026-07-19T10:00:00.000Z",
      updatedAt: "2026-07-19T10:01:00.000Z",
      messageCount: 2,
      messages: [
        {
          id: "message-user",
          role: "user",
          content: "Continue locally",
          createdAt: "2026-07-19T10:00:00.000Z",
        },
        {
          id: "message-assistant",
          role: "assistant",
          content: "Partial response",
          createdAt: "2026-07-19T10:01:00.000Z",
          status: "incomplete",
        },
      ],
    };

    expect(toChatMessageItems(conversation)).toEqual([
      { id: "message-user", role: "user", content: "Continue locally", status: undefined },
      {
        id: "message-assistant",
        role: "assistant",
        content: "Partial response",
        status: "incomplete",
      },
    ]);
  });

  it("does not expose hidden system messages in the transcript", () => {
    const conversation: Conversation = {
      id: "conversation-2" as ConversationId,
      title: "Local chat",
      schemaVersion: 1,
      createdAt: "2026-07-19T10:00:00.000Z",
      updatedAt: "2026-07-19T10:00:00.000Z",
      messageCount: 1,
      messages: [
        {
          id: "message-system",
          role: "system",
          content: "Runtime-only instruction",
          createdAt: "2026-07-19T10:00:00.000Z",
        },
      ],
    };

    expect(toChatMessageItems(conversation)).toEqual([]);
  });
});

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

  it("passes Markdown source through unchanged — rendering is a presentation-only concern", () => {
    const markdownSource = "# Heading\n\n**bold** and `inline code`\n\n```python\nprint('hi')\n```\n\n- item";
    const conversation: Conversation = {
      id: "conversation-markdown" as ConversationId,
      title: "Local chat",
      schemaVersion: 1,
      createdAt: "2026-07-19T10:00:00.000Z",
      updatedAt: "2026-07-19T10:00:00.000Z",
      messageCount: 1,
      messages: [
        {
          id: "message-assistant",
          role: "assistant",
          content: markdownSource,
          createdAt: "2026-07-19T10:00:00.000Z",
        },
      ],
    };

    const [item] = toChatMessageItems(conversation);
    expect(item?.content).toBe(markdownSource);
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

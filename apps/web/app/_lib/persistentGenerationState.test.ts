import { describe, expect, it } from "vitest";
import type { ConversationId } from "@free-ai-open/conversation-store";
import {
  isGenerationCurrent,
  removeAssistantMessage,
  setAssistantContent,
  type ActiveGenerationDescriptor,
} from "./persistentGenerationState";

const conversationId = "conversation-1" as ConversationId;
const activeGeneration: ActiveGenerationDescriptor = {
  generationId: "generation-1",
  conversationId,
  assistantMessageId: "assistant-1",
};

describe("persistent generation state", () => {
  it("sets the active generation's assistant message to the given content", () => {
    const messages = [
      { id: "user-1", role: "user" as const, content: "Hello" },
      { id: "assistant-1", role: "assistant" as const, content: "" },
    ];

    expect(
      setAssistantContent(messages, activeGeneration, "generation-1", conversationId, "assistant-1", "Hi")
    ).toEqual([
      { id: "user-1", role: "user", content: "Hello" },
      { id: "assistant-1", role: "assistant", content: "Hi" },
    ]);
  });

  it("replaces (not appends) on each call, matching the accumulator-driven caller that always passes the full current value", () => {
    let providerMessages = [
      { id: "user-1", role: "user" as const, content: "Hello" },
      { id: "assistant-1", role: "assistant" as const, content: "" },
    ];

    providerMessages = setAssistantContent(
      providerMessages,
      activeGeneration,
      "generation-1",
      conversationId,
      "assistant-1",
      "Still "
    );
    providerMessages = setAssistantContent(
      providerMessages,
      activeGeneration,
      "generation-1",
      conversationId,
      "assistant-1",
      "Still running"
    );

    expect(providerMessages).toEqual([
      { id: "user-1", role: "user", content: "Hello" },
      { id: "assistant-1", role: "assistant", content: "Still running" },
    ]);
  });

  it("ignores late updates from stale generations", () => {
    const messages = [{ id: "assistant-1", role: "assistant" as const, content: "New" }];

    expect(
      setAssistantContent(messages, activeGeneration, "generation-old", conversationId, "assistant-1", "stale")
    ).toEqual(messages);
  });

  it("requires both generation and conversation identity to match", () => {
    expect(isGenerationCurrent(activeGeneration, "generation-1", conversationId)).toBe(true);
    expect(isGenerationCurrent(activeGeneration, "generation-1", "conversation-2" as ConversationId)).toBe(false);
  });

  it("removes an abandoned assistant placeholder without touching other messages", () => {
    expect(
      removeAssistantMessage(
        [
          { id: "user-1", role: "user", content: "Hello" },
          { id: "assistant-1", role: "assistant", content: "Partial" },
        ],
        "assistant-1"
      )
    ).toEqual([{ id: "user-1", role: "user", content: "Hello" }]);
  });
});

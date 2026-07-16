import { describe, expect, it } from "vitest";
import { newChatTaskOptions, resolveConversationTask, taskCategories } from "./catalog";

describe("newChatTaskOptions", () => {
  it("excludes document_analysis, since the product has no document upload entry point yet", () => {
    expect(newChatTaskOptions.some((task) => task.id === "document_analysis")).toBe(false);
  });

  it("includes every other task category from the shared catalog", () => {
    const expectedIds = taskCategories.filter((task) => task.id !== "document_analysis").map((task) => task.id);
    expect(newChatTaskOptions.map((task) => task.id)).toEqual(expectedIds);
  });

  it("gives every option a label and a description key", () => {
    for (const task of newChatTaskOptions) {
      expect(task.labelKey).toBeTruthy();
      expect(task.descriptionKey).toBeTruthy();
    }
  });
});

describe("resolveConversationTask", () => {
  it("returns a valid task category unchanged", () => {
    expect(resolveConversationTask("coding")).toBe("coding");
  });

  it("defaults missing task metadata to general chat behavior", () => {
    expect(resolveConversationTask(undefined)).toBe("chat");
    expect(resolveConversationTask(null)).toBe("chat");
  });

  it("defaults an unrecognized/invalid stored value to general chat behavior", () => {
    expect(resolveConversationTask("not-a-real-task")).toBe("chat");
  });
});

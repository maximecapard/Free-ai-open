import { describe, expect, it, vi } from "vitest";
import { copyCodeToClipboard } from "./codeBlockCopy";

describe("copyCodeToClipboard", () => {
  it("copies the exact code text via the provided clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const outcome = await copyCodeToClipboard("print('hi')", { writeText });

    expect(outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("print('hi')");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("returns an error outcome when the clipboard rejects (permission denied)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    const outcome = await copyCodeToClipboard("code", { writeText });

    expect(outcome).toBe("error");
  });

  it("returns an error outcome when no clipboard is available (insecure/unavailable context)", async () => {
    expect(await copyCodeToClipboard("code", undefined)).toBe("error");
    expect(await copyCodeToClipboard("code", null)).toBe("error");
  });

  it("returns an error outcome for empty code without calling the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const outcome = await copyCodeToClipboard("", { writeText });

    expect(outcome).toBe("error");
    expect(writeText).not.toHaveBeenCalled();
  });
});

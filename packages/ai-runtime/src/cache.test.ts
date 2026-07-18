import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ hasModelInCache: vi.fn() }));

vi.mock("@mlc-ai/web-llm", () => ({ hasModelInCache: mocks.hasModelInCache }));

const { isModelCached } = await import("./cache");

describe("isModelCached", () => {
  it("returns true when WebLLM reports the model is already cached", async () => {
    mocks.hasModelInCache.mockResolvedValueOnce(true);
    expect(await isModelCached("Qwen3-0.6B-q4f16_1-MLC")).toBe(true);
    expect(mocks.hasModelInCache).toHaveBeenCalledWith("Qwen3-0.6B-q4f16_1-MLC");
  });

  it("returns false when WebLLM reports the model is not cached", async () => {
    mocks.hasModelInCache.mockResolvedValueOnce(false);
    expect(await isModelCached("Qwen3-4B-q4f16_1-MLC")).toBe(false);
  });

  it("defaults to false (assume a download is needed) rather than throwing when the cache check fails", async () => {
    mocks.hasModelInCache.mockRejectedValueOnce(new Error("Cache Storage unavailable"));
    await expect(isModelCached("Qwen3-4B-q4f16_1-MLC")).resolves.toBe(false);
  });
});

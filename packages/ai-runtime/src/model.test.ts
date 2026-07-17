import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID } from "./model";

describe("DEFAULT_MODEL_ID", () => {
  it("uses the verified compact WebLLM model without extra GPU feature requirements", () => {
    const record = prebuiltAppConfig.model_list.find((model) => model.model_id === DEFAULT_MODEL_ID);

    expect(DEFAULT_MODEL_ID).toBe("SmolLM2-360M-Instruct-q4f32_1-MLC");
    expect(record).toBeDefined();
    expect(record?.required_features ?? []).toEqual([]);
  });
});

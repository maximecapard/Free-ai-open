import { describe, expect, it } from "vitest";
import { modelRecordSchema, sampleModels } from "./index";

describe("modelRecordSchema", () => {
  it("validates every sample model", () => {
    for (const model of sampleModels) {
      const result = modelRecordSchema.safeParse(model);
      expect(result.success).toBe(true);
    }
  });

  it("rejects a record missing required metadata", () => {
    const result = modelRecordSchema.safeParse({
      id: "incomplete-model",
      displayName: "Incomplete",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range device tier", () => {
    const result = modelRecordSchema.safeParse({
      ...sampleModels[0],
      minDeviceTier: 9,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown backend value", () => {
    const result = modelRecordSchema.safeParse({
      ...sampleModels[0],
      backend: ["quantum"],
    });
    expect(result.success).toBe(false);
  });
});

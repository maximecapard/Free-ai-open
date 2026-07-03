import { describe, expect, it } from "vitest";
import { modelRecordSchema, sampleModels } from "./index";

const validModel = sampleModels[0];

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
      ...validModel,
      minDeviceTier: 9,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown backend value", () => {
    const result = modelRecordSchema.safeParse({
      ...validModel,
      backend: ["quantum"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown task category", () => {
    const result = modelRecordSchema.safeParse({
      ...validModel,
      tasks: ["chat", "spreadsheet"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty task and backend lists", () => {
    expect(
      modelRecordSchema.safeParse({
        ...validModel,
        tasks: [],
      }).success
    ).toBe(false);

    expect(
      modelRecordSchema.safeParse({
        ...validModel,
        backend: [],
      }).success
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = modelRecordSchema.safeParse({
      ...validModel,
      apiKey: "sk-should-not-be-here",
    });
    expect(result.success).toBe(false);
  });

  it("rejects secret-like metadata values", () => {
    const result = modelRecordSchema.safeParse({
      ...validModel,
      modelUrl: "https://models.example/model?api_key=secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid model URLs", () => {
    const result = modelRecordSchema.safeParse({
      ...validModel,
      modelUrl: "ftp://models.example/model",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid sha256 values", () => {
    const result = modelRecordSchema.safeParse({
      ...validModel,
      sha256: "not-a-hash",
    });
    expect(result.success).toBe(false);
  });

  it("rejects recommended tiers below the minimum tier", () => {
    const result = modelRecordSchema.safeParse({
      ...validModel,
      minDeviceTier: 3,
      recommendedDeviceTier: 2,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unverified stable models", () => {
    const result = modelRecordSchema.safeParse({
      ...validModel,
      status: "stable",
      verified: false,
    });
    expect(result.success).toBe(false);
  });
});

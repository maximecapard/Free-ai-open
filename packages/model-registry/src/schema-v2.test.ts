import { taskCategories } from "@free-ai-open/types";
import { describe, expect, it } from "vitest";
import { modelRegistryV2 } from "./registry-v2";
import {
  MODEL_REGISTRY_SCHEMA_VERSION,
  contextPresetIds,
  modelRegistryRecordSchema,
  taskSuitabilitySchema,
} from "./schema-v2";

const validModel = modelRegistryV2[0];

function cloneModel() {
  return structuredClone(validModel);
}

describe("modelRegistryRecordSchema", () => {
  it("validates the versioned registry record", () => {
    expect(MODEL_REGISTRY_SCHEMA_VERSION).toBe(2);
    expect(modelRegistryRecordSchema.parse(validModel)).toEqual(validModel);
  });

  it("scores exactly every TaskCategory", () => {
    expect(Object.keys(validModel.tasks)).toEqual(taskCategories);
    expect(taskSuitabilitySchema.safeParse(validModel.tasks).success).toBe(true);
    expect(taskSuitabilitySchema.safeParse({ ...validModel.tasks, unknown_task: 1 }).success).toBe(false);
  });

  it("requires all three ordered context presets", () => {
    expect(validModel.contextPresets.map((preset) => preset.id)).toEqual(contextPresetIds);

    const reversed = cloneModel();
    reversed.contextPresets.reverse();
    expect(modelRegistryRecordSchema.safeParse(reversed).success).toBe(false);
  });

  it("rejects incomplete verification metadata", () => {
    const missingVersion = cloneModel();
    delete missingVersion.verifiedWithWebLLMVersion;
    expect(modelRegistryRecordSchema.safeParse(missingVersion).success).toBe(false);

    const missingDate = cloneModel();
    delete missingDate.verifiedAt;
    expect(modelRegistryRecordSchema.safeParse(missingDate).success).toBe(false);
  });

  it("rejects invalid status, language, suitability, and capability metadata", () => {
    expect(modelRegistryRecordSchema.safeParse({ ...cloneModel(), status: "stable" }).success).toBe(false);
    expect(
      modelRegistryRecordSchema.safeParse({
        ...cloneModel(),
        languages: { ...validModel.languages, fr: "excellent" },
      }).success
    ).toBe(false);
    expect(
      modelRegistryRecordSchema.safeParse({
        ...cloneModel(),
        formFactors: { ...validModel.formFactors, mobile: 6 },
      }).success
    ).toBe(false);
    expect(
      modelRegistryRecordSchema.safeParse({
        ...cloneModel(),
        minimumCapability: { ...validModel.minimumCapability, approximateMemoryGB: -1 },
      }).success
    ).toBe(false);
  });

  it("keeps unmeasured estimates explicitly unknown", () => {
    const unknownRuntimeMemory = cloneModel();
    unknownRuntimeMemory.runtimeMemory = {
      unit: "bytes",
      confidence: "low",
      source: "https://example.test/unmeasured-runtime-memory",
      testedDeviceClass: "unknown",
    };

    const parsed = modelRegistryRecordSchema.parse(unknownRuntimeMemory);
    expect(parsed.runtimeMemory.value).toBeUndefined();
  });

  it("rejects unexpected fields and unsafe URL schemes", () => {
    expect(modelRegistryRecordSchema.safeParse({ ...cloneModel(), apiKey: "not-allowed" }).success).toBe(false);
    expect(
      modelRegistryRecordSchema.safeParse({
        ...cloneModel(),
        source: { ...validModel.source, modelUrl: "http://example.test/model" },
      }).success
    ).toBe(false);
  });

  it("requires complete source and license metadata", () => {
    const missingLicense = { ...cloneModel(), license: undefined };
    expect(modelRegistryRecordSchema.safeParse(missingLicense).success).toBe(false);

    const missingSource = { ...cloneModel(), source: undefined };
    expect(modelRegistryRecordSchema.safeParse(missingSource).success).toBe(false);
  });

  it("rejects self-references and duplicate fallbacks", () => {
    expect(
      modelRegistryRecordSchema.safeParse({ ...cloneModel(), fallbackModelIds: [validModel.id] }).success
    ).toBe(false);
    expect(
      modelRegistryRecordSchema.safeParse({
        ...cloneModel(),
        fallbackModelIds: ["qwen3-0.6b-q4f16", "qwen3-0.6b-q4f16"],
      }).success
    ).toBe(false);
  });
});

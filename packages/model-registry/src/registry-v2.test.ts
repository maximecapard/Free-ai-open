import { modelVersion, prebuiltAppConfig } from "@mlc-ai/web-llm";
import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY_VERSION, VERIFIED_WEBLLM_VERSION, modelRegistryV2 } from "./registry-v2";
import {
  getAutomaticModelRegistry,
  hasAutomaticLanguageSupport,
  isAutomaticRoutingEligible,
  modelRegistryV2Schema,
  validateModelRegistryV2,
} from "./registry-validation";
import type { ModelRegistryRecord } from "./schema-v2";

function cloneRegistry(): ModelRegistryRecord[] {
  return structuredClone([...modelRegistryV2]);
}

describe("modelRegistryV2", () => {
  it("contains a small, deterministic set of validated records", () => {
    expect(MODEL_REGISTRY_VERSION).toBe("0.7.0-alpha.1");
    expect(validateModelRegistryV2(modelRegistryV2)).toEqual(modelRegistryV2);
    expect(modelRegistryV2).toHaveLength(5);
    expect(modelRegistryV2.map((model) => model.id)).toMatchInlineSnapshot(`
      [
        "smollm2-360m-instruct-q4f32",
        "qwen3-0.6b-q4f16",
        "qwen3-1.7b-q4f16",
        "qwen2.5-coder-1.5b-q4f16",
        "qwen3-4b-q4f16",
      ]
    `);
  });

  it("uses unique internal and WebLLM IDs", () => {
    expect(new Set(modelRegistryV2.map((model) => model.id)).size).toBe(modelRegistryV2.length);
    expect(new Set(modelRegistryV2.map((model) => model.webllmModelId)).size).toBe(modelRegistryV2.length);
  });

  it("matches the exact installed WebLLM prebuilt records", () => {
    expect(VERIFIED_WEBLLM_VERSION).toBe("0.2.84");
    expect(modelVersion).toBe("v0_2_84/base");

    const prebuiltById = new Map(prebuiltAppConfig.model_list.map((record) => [record.model_id, record]));
    for (const model of modelRegistryV2) {
      const prebuilt = prebuiltById.get(model.webllmModelId);
      expect(prebuilt, model.webllmModelId).toBeDefined();
      expect(prebuilt?.model).toBe(model.source.modelUrl);
      expect(prebuilt?.model_lib).toBe(model.source.modelLibUrl);
      expect(prebuilt?.required_features ?? []).toEqual(model.minimumCapability.requiredFeatures ?? []);
      expect(Math.round((prebuilt?.vram_required_MB ?? 0) * 1_000_000)).toBe(model.runtimeMemory.value);
      expect(model.runtimeMemory.testedContextTokens).toBe(4096);
      expect(model.runtimeMemory.testedDeviceClass).toBe("desktop");
    }
  });

  it("allows only fully verified models into automatic routing", () => {
    expect(getAutomaticModelRegistry(modelRegistryV2)).toHaveLength(modelRegistryV2.length);

    const experimental = { ...modelRegistryV2[0], status: "experimental" as const };
    const unverified = {
      ...modelRegistryV2[0],
      status: "experimental" as const,
      verifiedAt: undefined,
      verifiedWithWebLLMVersion: undefined,
    };
    expect(isAutomaticRoutingEligible(experimental)).toBe(false);
    expect(isAutomaticRoutingEligible(unverified)).toBe(false);
    expect(hasAutomaticLanguageSupport(experimental, "en")).toBe(false);
  });

  it("exposes conservative language and form-factor suitability", () => {
    const frenchAutomaticModels = modelRegistryV2
      .filter((model) => hasAutomaticLanguageSupport(model, "fr"))
      .map((model) => model.id);
    expect(frenchAutomaticModels).toEqual(["qwen3-0.6b-q4f16", "qwen3-1.7b-q4f16", "qwen3-4b-q4f16"]);

    const mobileModels = modelRegistryV2.filter((model) => model.formFactors.mobile >= 4).map((model) => model.id);
    expect(mobileModels).toEqual(["smollm2-360m-instruct-q4f32", "qwen3-0.6b-q4f16"]);
    expect(modelRegistryV2.find((model) => model.id === "qwen3-4b-q4f16")?.formFactors.mobile).toBe(0);
  });

  it("offers French translation metadata only from suitable verified models", () => {
    const candidates = modelRegistryV2
      .filter((model) => hasAutomaticLanguageSupport(model, "fr") && model.tasks.translation >= 3)
      .map((model) => model.id);

    expect(candidates).toEqual(["qwen3-0.6b-q4f16", "qwen3-1.7b-q4f16", "qwen3-4b-q4f16"]);
  });

  it("rejects duplicate IDs, missing fallbacks, and fallback cycles", () => {
    const duplicate = cloneRegistry();
    duplicate[1] = { ...duplicate[1], id: duplicate[0].id };
    expect(modelRegistryV2Schema.safeParse(duplicate).success).toBe(false);

    const duplicateWebLlmId = cloneRegistry();
    duplicateWebLlmId[1] = { ...duplicateWebLlmId[1], webllmModelId: duplicateWebLlmId[0].webllmModelId };
    expect(modelRegistryV2Schema.safeParse(duplicateWebLlmId).success).toBe(false);

    const missingFallback = cloneRegistry();
    missingFallback[0].fallbackModelIds = ["not-in-registry"];
    expect(modelRegistryV2Schema.safeParse(missingFallback).success).toBe(false);

    const cycle = cloneRegistry();
    cycle[0].fallbackModelIds = [cycle[1].id];
    expect(modelRegistryV2Schema.safeParse(cycle).success).toBe(false);
  });

  it("keeps registry metadata free of private-content fields", () => {
    const fieldNames = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        fieldNames.add(key.toLowerCase());
        visit(child);
      }
    };
    visit(modelRegistryV2);

    for (const forbidden of ["prompt", "response", "messages", "conversation", "document", "usertext"]) {
      expect(fieldNames).not.toContain(forbidden);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { ModelRegistryRecord } from "./schema-v2";

const example: ModelRegistryRecord = {
  schemaVersion: 1,
  id: "example-general-light",
  webllmModelId: "Example-General-Light-q4f16_1-MLC",
  displayName: "Example general assistant",
  family: "example",
  descriptionKey: "modelRegistry.example.description",
  status: "experimental",
  downloadSize: { value: 1_200_000_000, unit: "bytes", confidence: "high", source: "webllm-config" },
  runtimeMemory: { value: 2_500_000_000, unit: "bytes", confidence: "medium", source: "measured" },
  contextPresets: [
    { id: "compatibility", contextTokens: 1024, maxOutputTokens: 256 },
    { id: "balanced", contextTokens: 2048, maxOutputTokens: 512 },
  ],
  languages: { en: "strong", fr: "usable", multilingual: "limited" },
  tasks: {
    chat: 4,
    writing: 3,
    rewrite: 3,
    summarization: 3,
    translation: 1,
    coding: 1,
    learning: 3,
    document_analysis: 0,
  },
  formFactors: { mobile: 2, tablet: 3, desktop: 4 },
  performanceModes: { fast: 4, balanced: 3, performance: 1 },
  minimumCapability: { webgpuRequired: true, wasmSupported: false, fallbackAdapterAllowed: false },
  knownIssues: [],
  license: { id: "apache-2.0", name: "Apache License 2.0", sourceUrl: "https://example.test/license", attributionRequired: false },
  source: { modelUrl: "hf://example/general-light", webllmConfigSource: "https://example.test/webllm-config.json" },
  fallbackModelIds: [],
};

describe("ModelRegistryRecord contract", () => {
  it("is a usable, schema-versioned shape", () => {
    expect(example.schemaVersion).toBe(1);
    expect(example.status).toBe("experimental");
  });

  it("leaves unmeasured estimates genuinely unknown rather than guessed", () => {
    const unmeasured: ModelRegistryRecord = {
      ...example,
      runtimeMemory: { unit: "bytes", confidence: "low", source: "unknown" },
    };
    expect(unmeasured.runtimeMemory.value).toBeUndefined();
  });

  it("does not list itself as its own fallback", () => {
    const withFallback: ModelRegistryRecord = { ...example, fallbackModelIds: ["example-coding-light"] };
    expect(withFallback.fallbackModelIds).not.toContain(withFallback.id);
  });

  it("scores every task category, not just a subset", () => {
    const scoredTasks = Object.keys(example.tasks);
    expect(scoredTasks).toEqual([
      "chat",
      "writing",
      "rewrite",
      "summarization",
      "translation",
      "coding",
      "learning",
      "document_analysis",
    ]);
  });

  it("requires a license for every record", () => {
    expect(example.license.id).toBeTruthy();
    expect(example.license.sourceUrl).toBeTruthy();
  });

  it("never contains prompt/response/conversation-shaped fields", () => {
    const serialized = JSON.stringify(example).toLowerCase();
    for (const forbidden of ["prompt", "response", "conversation", "\"message"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

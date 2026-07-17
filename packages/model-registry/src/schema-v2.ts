import type { CapabilityConfidence, TaskCategory } from "@free-ai-open/types";

// v0.7.0-alpha "Adaptive Model Router v1" model registry contract (Phase 0:
// contracts and architecture only — see 04_MODEL_REGISTRY_PROMPT_CLAUDE.md
// for the later phase that actually populates verified records against this
// shape). This coexists with, and does not replace, the active v0.6
// `ModelRecord`/`modelRecordSchema`/`sampleModels` in ./schema and
// ./registry, which remain the routing path `selectRecommendedModel()` uses
// today. No `ModelRegistryRecord` values exist yet.

export type ModelStatus = "verified" | "experimental" | "deprecated" | "unavailable";

export type LanguageSupport = "strong" | "usable" | "limited" | "unknown";

// 0 (unsuitable) through 5 (ideal). Never left implicit: an unknown fit
// should be recorded as a low, honest score rather than omitted.
export type Suitability = 0 | 1 | 2 | 3 | 4 | 5;

// An estimate that stays honestly unknown rather than guessing. `value` is
// absent when genuinely not measured; `confidence`/`source` explain how much
// to trust it and where it came from (e.g. "webllm-config", "measured").
export interface Estimate {
  value?: number;
  unit: "bytes" | "tokens";
  confidence: CapabilityConfidence;
  source: string;
}

export interface ContextPreset {
  id: "compatibility" | "balanced" | "performance";
  contextTokens: number;
  maxOutputTokens: number;
  estimatedExtraMemoryBytes?: number;
}

export interface ModelRegistryRecord {
  schemaVersion: number;

  id: string;
  webllmModelId: string;
  displayName: string;
  family: string;
  descriptionKey: string;

  status: ModelStatus;
  verifiedAt?: string;
  verifiedWithWebLLMVersion?: string;

  quantization?: string;
  parameterClass?: string;

  downloadSize: Estimate;
  runtimeMemory: Estimate;

  contextPresets: ContextPreset[];

  languages: {
    en: LanguageSupport;
    fr: LanguageSupport;
    multilingual: LanguageSupport;
  };

  tasks: Record<TaskCategory, Suitability>;

  formFactors: {
    mobile: Suitability;
    tablet: Suitability;
    desktop: Suitability;
  };

  performanceModes: {
    fast: Suitability;
    balanced: Suitability;
    performance: Suitability;
  };

  minimumCapability: {
    webgpuRequired: boolean;
    wasmSupported: boolean;
    fallbackAdapterAllowed: boolean;
    approximateMemoryGB?: number;
    requiredFeatures?: string[];
    minimumLimits?: Record<string, number>;
  };

  knownIssues: string[];
  license: {
    id: string;
    name: string;
    sourceUrl: string;
    attributionRequired: boolean;
  };

  source: {
    modelUrl: string;
    webllmConfigSource: string;
  };

  // Must not contain `id` itself and must not form a cycle with any other
  // record's fallbackModelIds once real records exist (see
  // 15_ROUTER_SCORING_SPEC.md's "Aucun cycle" rule).
  fallbackModelIds: string[];
}

import { validateModelRegistryV2 } from "./registry-validation";
import type { ContextPreset, Estimate, ModelRegistryRecord } from "./schema-v2";

export const MODEL_REGISTRY_VERSION = "0.7.0-alpha.1";
export const VERIFIED_WEBLLM_VERSION = "0.2.84";

const VERIFIED_AT = "2026-07-17T12:12:00.000Z";
const WEBLLM_CONFIG_SOURCE = "https://unpkg.com/@mlc-ai/web-llm@0.2.84/lib/index.js";
const APACHE_LICENSE_NAME = "Apache License 2.0";

function downloadEstimate(value: number, source: string, confidence: Estimate["confidence"] = "high"): Estimate {
  return { value, unit: "bytes", confidence, source };
}

function runtimeEstimate(value: number): Estimate {
  return {
    value,
    unit: "bytes",
    confidence: "medium",
    source: WEBLLM_CONFIG_SOURCE,
    testedContextTokens: 4096,
    testedDeviceClass: "desktop",
  };
}

function contextPresets(performanceOutputTokens: number): ContextPreset[] {
  return [
    { id: "compatibility", contextTokens: 1024, maxOutputTokens: 256 },
    { id: "balanced", contextTokens: 2048, maxOutputTokens: 512 },
    { id: "performance", contextTokens: 4096, maxOutputTokens: performanceOutputTokens },
  ];
}

const records = [
  {
    schemaVersion: 2,
    id: "smollm2-360m-instruct-q4f32",
    webllmModelId: "SmolLM2-360M-Instruct-q4f32_1-MLC",
    displayName: "Compact local model",
    family: "SmolLM2",
    descriptionKey: "modelRegistry.smollm2Compact.description",
    status: "verified",
    verifiedAt: VERIFIED_AT,
    verifiedWithWebLLMVersion: VERIFIED_WEBLLM_VERSION,
    quantization: "q4f32_1",
    parameterClass: "360m",
    downloadSize: downloadEstimate(
      207_365_832,
      "https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC/tree/main"
    ),
    runtimeMemory: runtimeEstimate(579_610_000),
    contextPresets: contextPresets(768),
    languages: { en: "usable", fr: "limited", multilingual: "limited" },
    tasks: {
      chat: 2,
      writing: 1,
      rewrite: 1,
      summarization: 1,
      translation: 0,
      coding: 1,
      learning: 1,
      document_analysis: 0,
    },
    formFactors: { mobile: 5, tablet: 5, desktop: 3 },
    performanceModes: { fast: 5, balanced: 2, performance: 0 },
    minimumCapability: {
      webgpuRequired: true,
      wasmSupported: false,
      fallbackAdapterAllowed: false,
      requiredFeatures: [],
    },
    knownIssues: [
      "Low-capacity compatibility model; use for short, simple requests rather than complex analysis.",
      "French output completed in the verification smoke test but language quality is not documented strongly upstream.",
      "The installed WebLLM configuration limits context to 4,096 tokens.",
    ],
    license: {
      id: "apache-2.0",
      name: APACHE_LICENSE_NAME,
      sourceUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/blob/main/LICENSE",
      attributionRequired: true,
    },
    source: {
      modelUrl: "https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC",
      modelLibUrl:
        "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/SmolLM2-360M-Instruct-q4f32_1_cs1k-webgpu.wasm",
      upstreamModelUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct",
      webllmConfigSource: WEBLLM_CONFIG_SOURCE,
    },
    fallbackModelIds: [],
  },
  {
    schemaVersion: 2,
    id: "qwen3-0.6b-q4f16",
    webllmModelId: "Qwen3-0.6B-q4f16_1-MLC",
    displayName: "Light multilingual model",
    family: "Qwen3",
    descriptionKey: "modelRegistry.qwen3Light.description",
    status: "verified",
    verifiedAt: VERIFIED_AT,
    verifiedWithWebLLMVersion: VERIFIED_WEBLLM_VERSION,
    quantization: "q4f16_1",
    parameterClass: "0.6b",
    downloadSize: downloadEstimate(
      351_517_143,
      "https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/tree/main"
    ),
    runtimeMemory: runtimeEstimate(1_403_340_000),
    contextPresets: contextPresets(768),
    languages: { en: "strong", fr: "usable", multilingual: "usable" },
    tasks: {
      chat: 3,
      writing: 3,
      rewrite: 3,
      summarization: 2,
      translation: 3,
      coding: 2,
      learning: 2,
      document_analysis: 1,
    },
    formFactors: { mobile: 4, tablet: 5, desktop: 3 },
    performanceModes: { fast: 4, balanced: 3, performance: 1 },
    minimumCapability: {
      webgpuRequired: true,
      wasmSupported: false,
      fallbackAdapterAllowed: false,
      requiredFeatures: [],
    },
    knownIssues: [
      "Small multilingual model; instruction following and factual depth are more limited than larger Qwen3 variants.",
      "Short smoke-test requests sometimes used much of the output budget; generation limits remain necessary.",
      "The installed WebLLM configuration limits context to 4,096 tokens.",
    ],
    license: {
      id: "apache-2.0",
      name: APACHE_LICENSE_NAME,
      sourceUrl: "https://huggingface.co/Qwen/Qwen3-0.6B/blob/main/LICENSE",
      attributionRequired: true,
    },
    source: {
      modelUrl: "https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC",
      modelLibUrl:
        "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm",
      upstreamModelUrl: "https://huggingface.co/Qwen/Qwen3-0.6B",
      webllmConfigSource: WEBLLM_CONFIG_SOURCE,
    },
    fallbackModelIds: ["smollm2-360m-instruct-q4f32"],
  },
  {
    schemaVersion: 2,
    id: "qwen3-1.7b-q4f16",
    webllmModelId: "Qwen3-1.7B-q4f16_1-MLC",
    displayName: "Balanced multilingual model",
    family: "Qwen3",
    descriptionKey: "modelRegistry.qwen3Balanced.description",
    status: "verified",
    verifiedAt: VERIFIED_AT,
    verifiedWithWebLLMVersion: VERIFIED_WEBLLM_VERSION,
    quantization: "q4f16_1",
    parameterClass: "1.7b",
    downloadSize: downloadEstimate(
      984_156_278,
      "https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/tree/main"
    ),
    runtimeMemory: runtimeEstimate(2_036_660_000),
    contextPresets: contextPresets(1024),
    languages: { en: "strong", fr: "usable", multilingual: "usable" },
    tasks: {
      chat: 4,
      writing: 4,
      rewrite: 4,
      summarization: 4,
      translation: 4,
      coding: 3,
      learning: 4,
      document_analysis: 3,
    },
    formFactors: { mobile: 2, tablet: 4, desktop: 4 },
    performanceModes: { fast: 2, balanced: 5, performance: 3 },
    minimumCapability: {
      webgpuRequired: true,
      wasmSupported: false,
      fallbackAdapterAllowed: false,
      requiredFeatures: [],
    },
    knownIssues: [
      "Not intended as the default on phones; the download and runtime-memory estimates are materially higher than the light model.",
      "Short smoke-test requests sometimes used much of the output budget; generation limits remain necessary.",
      "The installed WebLLM configuration limits context to 4,096 tokens.",
    ],
    license: {
      id: "apache-2.0",
      name: APACHE_LICENSE_NAME,
      sourceUrl: "https://huggingface.co/Qwen/Qwen3-1.7B/blob/main/LICENSE",
      attributionRequired: true,
    },
    source: {
      modelUrl: "https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC",
      modelLibUrl:
        "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm",
      upstreamModelUrl: "https://huggingface.co/Qwen/Qwen3-1.7B",
      webllmConfigSource: WEBLLM_CONFIG_SOURCE,
    },
    fallbackModelIds: ["qwen3-0.6b-q4f16", "smollm2-360m-instruct-q4f32"],
  },
  {
    schemaVersion: 2,
    id: "qwen2.5-coder-1.5b-q4f16",
    webllmModelId: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
    displayName: "Coding-focused local model",
    family: "Qwen2.5-Coder",
    descriptionKey: "modelRegistry.qwenCoderCompact.description",
    status: "verified",
    verifiedAt: VERIFIED_AT,
    verifiedWithWebLLMVersion: VERIFIED_WEBLLM_VERSION,
    quantization: "q4f16_1",
    parameterClass: "1.5b",
    downloadSize: downloadEstimate(
      880_289_173,
      "https://huggingface.co/mlc-ai/Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC/tree/main"
    ),
    runtimeMemory: runtimeEstimate(1_629_750_000),
    contextPresets: contextPresets(1024),
    languages: { en: "strong", fr: "limited", multilingual: "limited" },
    tasks: {
      chat: 2,
      writing: 1,
      rewrite: 1,
      summarization: 1,
      translation: 1,
      coding: 5,
      learning: 3,
      document_analysis: 1,
    },
    formFactors: { mobile: 1, tablet: 3, desktop: 4 },
    performanceModes: { fast: 2, balanced: 4, performance: 4 },
    minimumCapability: {
      webgpuRequired: true,
      wasmSupported: false,
      fallbackAdapterAllowed: false,
      requiredFeatures: [],
    },
    knownIssues: [
      "Specialized for coding; general writing, translation, and French suitability are intentionally scored conservatively.",
      "The installed WebLLM configuration limits context to 4,096 tokens despite a larger upstream theoretical context.",
    ],
    license: {
      id: "apache-2.0",
      name: APACHE_LICENSE_NAME,
      sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct/blob/main/LICENSE",
      attributionRequired: true,
    },
    source: {
      modelUrl: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
      modelLibUrl:
        "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
      upstreamModelUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct",
      webllmConfigSource: WEBLLM_CONFIG_SOURCE,
    },
    fallbackModelIds: ["qwen3-1.7b-q4f16", "qwen3-0.6b-q4f16", "smollm2-360m-instruct-q4f32"],
  },
  {
    schemaVersion: 2,
    id: "qwen3-4b-q4f16",
    webllmModelId: "Qwen3-4B-q4f16_1-MLC",
    displayName: "Performance local model",
    family: "Qwen3",
    descriptionKey: "modelRegistry.qwen3Performance.description",
    status: "verified",
    verifiedAt: VERIFIED_AT,
    verifiedWithWebLLMVersion: VERIFIED_WEBLLM_VERSION,
    quantization: "q4f16_1",
    parameterClass: "4b",
    downloadSize: downloadEstimate(
      2_280_000_000,
      "https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC/tree/main",
      "medium"
    ),
    runtimeMemory: runtimeEstimate(3_431_590_000),
    contextPresets: contextPresets(1024),
    languages: { en: "strong", fr: "usable", multilingual: "usable" },
    tasks: {
      chat: 5,
      writing: 5,
      rewrite: 5,
      summarization: 5,
      translation: 5,
      coding: 4,
      learning: 5,
      document_analysis: 4,
    },
    formFactors: { mobile: 0, tablet: 1, desktop: 5 },
    performanceModes: { fast: 0, balanced: 3, performance: 5 },
    minimumCapability: {
      webgpuRequired: true,
      wasmSupported: false,
      fallbackAdapterAllowed: false,
      requiredFeatures: [],
    },
    knownIssues: [
      "Large multi-gigabyte download and materially higher runtime-memory requirement; automatic use should be desktop-only and evidence-based.",
      "The local verification run was substantially slower than the smaller candidates on the tested desktop browser.",
      "Short smoke-test requests sometimes used much of the output budget; generation limits remain necessary.",
      "The installed WebLLM configuration limits context to 4,096 tokens.",
    ],
    license: {
      id: "apache-2.0",
      name: APACHE_LICENSE_NAME,
      sourceUrl: "https://huggingface.co/Qwen/Qwen3-4B/blob/main/LICENSE",
      attributionRequired: true,
    },
    source: {
      modelUrl: "https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC",
      modelLibUrl:
        "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-4B-q4f16_1_cs1k-webgpu.wasm",
      upstreamModelUrl: "https://huggingface.co/Qwen/Qwen3-4B",
      webllmConfigSource: WEBLLM_CONFIG_SOURCE,
    },
    fallbackModelIds: ["qwen3-1.7b-q4f16", "qwen3-0.6b-q4f16", "smollm2-360m-instruct-q4f32"],
  },
] satisfies ModelRegistryRecord[];

export const modelRegistryV2: readonly ModelRegistryRecord[] = validateModelRegistryV2(records);

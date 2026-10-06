// Fixed compatibility default until the adaptive v0.7 router is connected to
// the runtime. This verified WebLLM variant requires no extra GPU features.
export const DEFAULT_MODEL_ID = "SmolLM2-360M-Instruct-q4f32_1-MLC";

// The @mlc-ai/web-llm version this package is built and verified against --
// see runtime.ts's own top-of-file note for the exact API capabilities this
// specific version was verified to have (matches packages/ai-runtime/package.json
// and pnpm-lock.yaml). Kept as one named, exported constant so any caller
// needing to identify "which WebLLM version is actually running" (e.g. a
// model-benchmark result's environment metadata) has a single trusted
// source to derive it from, rather than each caller hardcoding the string
// itself or accepting an arbitrary caller-supplied value for something
// this package already knows authoritatively.
export const INSTALLED_WEBLLM_VERSION = "0.2.84";

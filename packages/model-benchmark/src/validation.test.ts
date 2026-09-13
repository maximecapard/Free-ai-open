import { describe, expect, it } from "vitest";
import type { ModelBenchmarkResult } from "@free-ai-open/types";
import { MODEL_BENCHMARK_SCHEMA_VERSION, MODEL_BENCHMARK_VERSION } from "./constants";
import { calculateModelBenchmarkExpiry } from "./expiry";
import { sanitizeModelBenchmarkResult } from "./validation";

function buildValid(): ModelBenchmarkResult {
  return {
    schemaVersion: MODEL_BENCHMARK_SCHEMA_VERSION,
    benchmarkVersion: MODEL_BENCHMARK_VERSION,
    id: "benchmark-1",
    modelId: "qwen3-4b-instruct-q4f16",
    model: {
      modelId: "qwen3-4b-instruct-q4f16",
      webllmModelId: "Qwen3-4B-Instruct-q4f16_1-MLC",
      registryVersion: "0.7.0-alpha.1",
      quantization: "q4f16_1",
      verifiedWithWebLLMVersion: "0.2.84",
    },
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: calculateModelBenchmarkExpiry("2026-08-01T10:00:00.000Z"),
    browserFamily: "chrome",
    capabilityProfileKey: "desktop:performance:webgpu:native",
    performanceMode: "performance",
    preset: "quick",
    runConfig: { contextPreset: "performance", contextWindowTokens: 4096, requestedOutputTokens: 512 },
    stage: "complete",
    outcome: "completed",
    // A timed load implies the load actually happened during this run --
    // modelLoadedDuringRun: false + a loadTimeMs would be claiming a
    // measurement that cannot have occurred (see item 5's "reused model +
    // load time" adversarial test below for the rejected counterpart).
    load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: true, loadTimeMs: 1200 },
    firstToken: { firstTokenTimeMs: 320 },
    generation: {
      generationDurationMs: 4200,
      generatedTokenCount: 96,
      tokenCountConfidence: "exact",
      generationTokensPerSecond: 22.9,
    },
    confidence: "medium",
    environment: { webllmVersion: "0.2.84", appVersion: "0.8.0-alpha" },
  };
}

describe("sanitizeModelBenchmarkResult -- schema validation", () => {
  it("accepts a fully valid result unchanged", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult(valid)).toEqual(valid);
  });

  it("is deterministic -- sanitizing the same valid input twice produces deep-equal output", () => {
    const valid = buildValid();
    const first = sanitizeModelBenchmarkResult(valid);
    const second = sanitizeModelBenchmarkResult(valid);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("rejects null, undefined, and non-object input without throwing", () => {
    expect(sanitizeModelBenchmarkResult(null)).toBeNull();
    expect(sanitizeModelBenchmarkResult(undefined)).toBeNull();
    expect(sanitizeModelBenchmarkResult("a string")).toBeNull();
    expect(sanitizeModelBenchmarkResult(42)).toBeNull();
    expect(() => sanitizeModelBenchmarkResult(null)).not.toThrow();
  });

  it("rejects a future, not-yet-supported schema version", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), schemaVersion: MODEL_BENCHMARK_SCHEMA_VERSION + 1 })).toBeNull();
  });

  it("rejects a past, no-longer-supported schema version", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), schemaVersion: 0 })).toBeNull();
  });

  it("rejects an invalid createdAt date", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), createdAt: "not-a-date" })).toBeNull();
  });

  it("rejects an invalid expiresAt date", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), expiresAt: "not-a-date" })).toBeNull();
  });

  it("rejects an impossible/unknown outcome string", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), outcome: "totally_made_up" })).toBeNull();
  });

  it("rejects an impossible/unknown stage string", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), stage: "totally_made_up" })).toBeNull();
  });

  it("rejects an unknown benchmark preset", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), preset: "ultra" })).toBeNull();
  });

  it("rejects an unknown context preset", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, runConfig: { ...valid.runConfig, contextPreset: "ultra" } })
    ).toBeNull();
  });

  it("rejects an unknown browser family", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), browserFamily: "netscape" })).toBeNull();
  });

  it("rejects an unknown performance mode", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), performanceMode: "turbo" })).toBeNull();
  });

  it("rejects a negative loadTimeMs", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, load: { ...valid.load, loadTimeMs: -1 } })).toBeNull();
  });

  it("rejects a negative firstTokenTimeMs", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), firstToken: { firstTokenTimeMs: -50 } })).toBeNull();
  });

  it("rejects a negative generationDurationMs", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, generation: { ...valid.generation, generationDurationMs: -1 } })
    ).toBeNull();
  });

  it("rejects a non-finite (Infinity/NaN) timing value rather than silently coercing it", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, load: { ...valid.load, loadTimeMs: Infinity } })).toBeNull();
    expect(sanitizeModelBenchmarkResult({ ...valid, load: { ...valid.load, loadTimeMs: Number.NaN } })).toBeNull();
  });

  it("rejects a negative contextWindowTokens or requestedOutputTokens", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, runConfig: { ...valid.runConfig, contextWindowTokens: -1 } })
    ).toBeNull();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, runConfig: { ...valid.runConfig, requestedOutputTokens: 0 } })
    ).toBeNull();
  });

  it("rejects a mismatch between the top-level modelId and the nested model reference's modelId", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, modelId: "a-different-model" })).toBeNull();
  });

  it("rejects a malformed modelId (uppercase, invalid characters)", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, modelId: "Not Valid!", model: { ...valid.model, modelId: "Not Valid!" } })).toBeNull();
  });

  it("drops generatedTokenCount/generationTokensPerSecond when tokenCountConfidence is unavailable, even if present in the raw input -- never trusts a character-length-derived rate", () => {
    const valid = buildValid();
    const withUnavailableConfidence = sanitizeModelBenchmarkResult({
      ...valid,
      generation: {
        tokenCountConfidence: "unavailable",
        generationDurationMs: 4000,
        generatedTokenCount: 999,
        generationTokensPerSecond: 250,
      },
    });
    expect(withUnavailableConfidence).not.toBeNull();
    const generation = withUnavailableConfidence!.generation;
    // `generation` is the "unavailable" branch of the discriminated union at
    // the type level, so `generatedTokenCount`/`generationTokensPerSecond`
    // are not even nameable properties on it -- checking with `in` (rather
    // than reading `.generatedTokenCount`) proves at runtime that a caller
    // who injected those fields anyway gets an object that truly lacks
    // them, not merely one where TypeScript pretends they don't exist.
    expect("generatedTokenCount" in generation).toBe(false);
    expect("generationTokensPerSecond" in generation).toBe(false);
    expect(generation.tokenCountConfidence).toBe("unavailable");
    expect((generation as { generationDurationMs?: number }).generationDurationMs).toBe(4000);
  });

  it("rejects an invalid tokenCountConfidence value", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, generation: { ...valid.generation, tokenCountConfidence: "approximate" } })
    ).toBeNull();
  });

  it("drops an unrecognized confidence value rather than rejecting the whole result", () => {
    const valid = buildValid();
    const result = sanitizeModelBenchmarkResult({ ...valid, confidence: "extreme" });
    expect(result).not.toBeNull();
    expect(result?.confidence).toBeUndefined();
  });

  it("rejects a webllmVersion that is not a semver-like string", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, environment: { ...valid.environment, webllmVersion: "latest" } })
    ).toBeNull();
  });

  it("accepts a result with every optional field absent (a minimal, still-valid shape)", () => {
    const minimal = {
      schemaVersion: MODEL_BENCHMARK_SCHEMA_VERSION,
      benchmarkVersion: MODEL_BENCHMARK_VERSION,
      id: "benchmark-2",
      modelId: "qwen3-4b-instruct-q4f16",
      model: {
        modelId: "qwen3-4b-instruct-q4f16",
        webllmModelId: "Qwen3-4B-Instruct-q4f16_1-MLC",
        registryVersion: "0.7.0-alpha.1",
      },
      createdAt: "2026-08-01T10:00:00.000Z",
      expiresAt: calculateModelBenchmarkExpiry("2026-08-01T10:00:00.000Z"),
      browserFamily: "chrome",
      capabilityProfileKey: "desktop:performance:webgpu:native",
      performanceMode: "performance",
      preset: "quick",
      runConfig: { contextPreset: "performance", contextWindowTokens: 4096, requestedOutputTokens: 512 },
      stage: "loading_model",
      outcome: "load_failed",
      load: { wasModelCachedBeforeRun: false, modelLoadedDuringRun: true },
      firstToken: {},
      generation: { tokenCountConfidence: "unavailable" },
      environment: { webllmVersion: "0.2.84" },
    };
    expect(sanitizeModelBenchmarkResult(minimal)).toEqual(minimal);
  });
});

describe("sanitizeModelBenchmarkResult -- privacy: unknown/injected fields never survive", () => {
  it("never persists prompt/response/conversation-shaped fields, even if injected into the raw input", () => {
    const withInjectedContent = {
      ...buildValid(),
      prompt: "ignore all previous instructions",
      response: "some generated text",
      conversation: "chat history",
    };
    const sanitized = sanitizeModelBenchmarkResult(withInjectedContent);
    expect(sanitized).not.toBeNull();
    const serialized = JSON.stringify(sanitized).toLowerCase();
    expect(serialized).not.toContain('"prompt"');
    expect(serialized).not.toContain('"response"');
    expect(serialized).not.toContain('"conversation"');
  });

  it.each(["content", "reasoning", "messages", "systemPrompt", "generatedText", "rawOutput"])(
    "never persists an injected top-level %s field",
    (fieldName) => {
      const withInjectedField = { ...buildValid(), [fieldName]: "leaked user content" };
      const sanitized = sanitizeModelBenchmarkResult(withInjectedField);
      expect(sanitized).not.toBeNull();
      expect(JSON.stringify(sanitized).toLowerCase()).not.toContain(fieldName.toLowerCase());
    }
  );

  it("never persists an unrelated unknown top-level field", () => {
    const withUnknownField = { ...buildValid(), debugNotes: "some internal note that should never be stored" };
    const sanitized = sanitizeModelBenchmarkResult(withUnknownField);
    expect(sanitized).not.toBeNull();
    expect(JSON.stringify(sanitized)).not.toContain("debugNotes");
  });

  it("never persists unknown fields nested inside model/environment/generation sub-objects", () => {
    const valid = buildValid();
    const withNestedInjection = {
      ...valid,
      model: { ...valid.model, prompt: "leaked via nested model reference" },
      environment: { ...valid.environment, systemPrompt: "leaked via nested environment" },
      generation: { ...valid.generation, rawOutput: "leaked via nested generation" },
    };
    const sanitized = sanitizeModelBenchmarkResult(withNestedInjection);
    expect(sanitized).not.toBeNull();
    const serialized = JSON.stringify(sanitized).toLowerCase();
    expect(serialized).not.toContain("leaked");
  });
});

describe("sanitizeModelBenchmarkResult -- exact token throughput invariants", () => {
  it("rejects tokenCountConfidence 'exact' with a missing generatedTokenCount", () => {
    const valid = buildValid();
    const withoutCount = { ...(valid.generation as unknown as Record<string, unknown>) };
    delete withoutCount.generatedTokenCount;
    expect(sanitizeModelBenchmarkResult({ ...valid, generation: withoutCount })).toBeNull();
  });

  it("rejects tokenCountConfidence 'exact' with a fractional generatedTokenCount", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, generation: { ...valid.generation, generatedTokenCount: 95.5, generationTokensPerSecond: 22.7 } })
    ).toBeNull();
  });

  it("rejects tokenCountConfidence 'exact' with a negative generatedTokenCount", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, generation: { ...valid.generation, generatedTokenCount: -5 } })).toBeNull();
  });

  it("rejects tokenCountConfidence 'exact' with a missing generationDurationMs", () => {
    const valid = buildValid();
    const withoutDuration = { ...(valid.generation as unknown as Record<string, unknown>) };
    delete withoutDuration.generationDurationMs;
    expect(sanitizeModelBenchmarkResult({ ...valid, generation: withoutDuration })).toBeNull();
  });

  it("rejects tokenCountConfidence 'exact' with a zero generationDurationMs", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, generation: { ...valid.generation, generationDurationMs: 0 } })).toBeNull();
  });

  it("rejects a NaN or Infinite generationTokensPerSecond", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, generation: { ...valid.generation, generationTokensPerSecond: Number.NaN } })
    ).toBeNull();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, generation: { ...valid.generation, generationTokensPerSecond: Infinity } })
    ).toBeNull();
  });

  it("rejects a generationTokensPerSecond that is not numerically consistent with count/duration", () => {
    const valid = buildValid();
    // 96 tokens / 4.2s ~= 22.86 tok/s -- 500 is nowhere near consistent.
    expect(
      sanitizeModelBenchmarkResult({ ...valid, generation: { ...valid.generation, generationTokensPerSecond: 500 } })
    ).toBeNull();
  });

  it("accepts a generationTokensPerSecond within the small rounding tolerance of count/duration", () => {
    const valid = buildValid();
    // Exact value would be 96 / 4.2 = 22.857142..., 22.9 is within tolerance.
    const sanitized = sanitizeModelBenchmarkResult(valid);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.generation).toEqual(valid.generation);
  });

  it("requires generationTokensPerSecond to be exactly 0 when generatedTokenCount is 0", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        generation: { tokenCountConfidence: "exact", generationDurationMs: 1000, generatedTokenCount: 0, generationTokensPerSecond: 0.1 },
      })
    ).toBeNull();
    // Stage stays "complete"/outcome "completed" (inherited from `valid`) --
    // that stage's own STAGES_WITH_FIRST_TOKEN requirement is satisfied by
    // `valid`'s existing firstToken.firstTokenTimeMs, independent of
    // whatever the FINAL generatedTokenCount turned out to be (a real
    // first-chunk event can still fire even for a run that ultimately
    // produced zero tokenizable output, e.g. an immediate stop signal).
    const sanitized = sanitizeModelBenchmarkResult({
      ...valid,
      generation: { tokenCountConfidence: "exact", generationDurationMs: 1000, generatedTokenCount: 0, generationTokensPerSecond: 0 },
    });
    expect(sanitized).not.toBeNull();
  });

  it("accepts a large but internally-consistent throughput measurement", () => {
    const valid = buildValid();
    const sanitized = sanitizeModelBenchmarkResult({
      ...valid,
      generation: { tokenCountConfidence: "exact", generationDurationMs: 10_000, generatedTokenCount: 500_000, generationTokensPerSecond: 50_000 },
    });
    expect(sanitized).not.toBeNull();
  });

  it("rejects a generationTokensPerSecond far beyond any plausible rate", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        generation: { tokenCountConfidence: "exact", generationDurationMs: 10, generatedTokenCount: 1, generationTokensPerSecond: 1_000_000 },
      })
    ).toBeNull();
  });

  it("never treats a character-derived count as an authoritative exact measurement -- 'exact' always requires all three fields present and consistent together", () => {
    const valid = buildValid();
    // A plausible-looking rate with no duration to back it up must still be
    // rejected -- there is no way to assert throughput without the
    // measurement that would make it verifiable.
    const malformedProvenance = { ...(valid.generation as unknown as Record<string, unknown>) };
    delete malformedProvenance.generationDurationMs;
    expect(
      sanitizeModelBenchmarkResult({ ...valid, generation: { ...malformedProvenance, generationTokensPerSecond: 22.9 } })
    ).toBeNull();
  });
});

describe("sanitizeModelBenchmarkResult -- capability profile key (item 3: coarse, low-entropy grammar)", () => {
  it("accepts every legitimate combination of the 4-segment grammar", () => {
    const valid = buildValid();
    for (const formFactor of ["mobile", "tablet", "desktop", "unknown"]) {
      for (const capabilityClass of ["compatibility", "light", "balanced", "performance"]) {
        const key = `${formFactor}:${capabilityClass}:webgpu:native`;
        expect(sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: key })).not.toBeNull();
      }
    }
  });

  it("rejects a UUID-like capability fingerprint", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c" })
    ).toBeNull();
  });

  it("rejects an exact GPU adapter description smuggled into the key", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "desktop:performance:webgpu:NVIDIA GeForce RTX 4090" })
    ).toBeNull();
  });

  it("rejects a long, high-entropy hardware signature string", () => {
    const valid = buildValid();
    const longSignature = "GPU=NVIDIA-RTX4090;DRIVER=551.23;VRAM=24576MB;CPU=Intel-i9-14900K;RAM=65536MB";
    expect(sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: longSignature })).toBeNull();
  });

  it("rejects a key with the wrong number of segments", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "desktop:performance:webgpu" })).toBeNull();
    expect(
      sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "desktop:performance:webgpu:native:extra" })
    ).toBeNull();
  });

  it("rejects a key with a segment outside its allowlist", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "server:performance:webgpu:native" })).toBeNull();
    expect(sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "desktop:extreme:webgpu:native" })).toBeNull();
    expect(sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "desktop:performance:webgl:native" })).toBeNull();
    expect(sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "desktop:performance:webgpu:emulated" })).toBeNull();
  });

  it("rejects a key that only differs from a valid one by casing", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, capabilityProfileKey: "Desktop:Performance:WebGPU:Native" })).toBeNull();
  });
});

describe("sanitizeModelBenchmarkResult -- benchmarkVersion / expiry invalidation (item 4)", () => {
  it("rejects an older, no-longer-current benchmarkVersion", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), benchmarkVersion: "0.9.0" })).toBeNull();
  });

  it("rejects an arbitrary/future benchmarkVersion", () => {
    expect(sanitizeModelBenchmarkResult({ ...buildValid(), benchmarkVersion: "2.0.0" })).toBeNull();
  });

  it("rejects an expiresAt earlier than the canonical createdAt + TTL formula", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, expiresAt: valid.createdAt })).toBeNull();
  });

  it("rejects a forged far-future expiresAt that does not match the canonical TTL formula", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult({ ...valid, expiresAt: "2099-01-01T00:00:00.000Z" })).toBeNull();
  });

  it("accepts an expiresAt exactly at the canonical createdAt + TTL boundary", () => {
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult(valid)?.expiresAt).toBe(calculateModelBenchmarkExpiry(valid.createdAt));
  });

  it("rejects a createdAt in the future relative to `now`", () => {
    const valid = buildValid();
    const futureCreatedAt = "2099-01-01T00:00:00.000Z";
    const result = { ...valid, createdAt: futureCreatedAt, expiresAt: calculateModelBenchmarkExpiry(futureCreatedAt) };
    expect(sanitizeModelBenchmarkResult(result, new Date("2026-08-01T10:00:00.000Z"))).toBeNull();
  });

  it("accepts a createdAt exactly equal to `now`", () => {
    const now = new Date("2026-08-01T10:00:00.000Z");
    const valid = buildValid();
    expect(sanitizeModelBenchmarkResult(valid, now)).not.toBeNull();
  });
});

describe("sanitizeModelBenchmarkResult -- stage/outcome/measurement legality (item 5)", () => {
  it("rejects stage 'not_started' paired with outcome 'completed' -- a run that never started cannot have completed", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        stage: "not_started",
        outcome: "completed",
        firstToken: {},
        generation: { tokenCountConfidence: "unavailable" },
        load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: false },
      })
    ).toBeNull();
  });

  it("rejects a load failure paired with generation metrics -- generation cannot have happened if loading never succeeded", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        stage: "loading_model",
        outcome: "load_failed",
        firstToken: {},
        load: { wasModelCachedBeforeRun: false, modelLoadedDuringRun: true, loadTimeMs: 500 },
      })
    ).toBeNull();
  });

  it("rejects a reused (already-loaded) model claiming a loadTimeMs measurement", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: false, loadTimeMs: 900 },
      })
    ).toBeNull();
  });

  it("rejects stage 'awaiting_first_token' with a firstTokenTimeMs already present -- no token has arrived yet by definition", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        stage: "awaiting_first_token",
        outcome: "stalled",
        firstToken: { firstTokenTimeMs: 100 },
        generation: { tokenCountConfidence: "unavailable" },
      })
    ).toBeNull();
  });

  it("rejects stage 'generating' with no firstTokenTimeMs -- at least one token must have arrived to reach this stage", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        stage: "generating",
        outcome: "stalled",
        firstToken: {},
        generation: { tokenCountConfidence: "unavailable" },
      })
    ).toBeNull();
  });

  it("rejects stage 'complete' with no generationDurationMs -- a run that reached its own terminal signal always has a wall-clock duration", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        generation: { tokenCountConfidence: "unavailable" },
      })
    ).toBeNull();
  });

  it("accepts stage 'complete' with only an approximate (unavailable-confidence) duration, no exact token count", () => {
    const valid = buildValid();
    const sanitized = sanitizeModelBenchmarkResult({
      ...valid,
      generation: { tokenCountConfidence: "unavailable", generationDurationMs: 4200 },
    });
    expect(sanitized).not.toBeNull();
  });

  it("rejects generation metrics attached to a stage that never reached generation (not_started/loading_model)", () => {
    const valid = buildValid();
    expect(
      sanitizeModelBenchmarkResult({
        ...valid,
        stage: "loading_model",
        outcome: "cancelled",
        firstToken: {},
        generation: { tokenCountConfidence: "exact", generationDurationMs: 100, generatedTokenCount: 5, generationTokensPerSecond: 50 },
      })
    ).toBeNull();
  });

  it("allows a user cancellation before inference with no inference metrics at all -- cancellation must never be penalized or fabricate metrics", () => {
    const valid = buildValid();
    const sanitized = sanitizeModelBenchmarkResult({
      ...valid,
      stage: "not_started",
      outcome: "cancelled",
      firstToken: {},
      generation: { tokenCountConfidence: "unavailable" },
      load: { wasModelCachedBeforeRun: true, modelLoadedDuringRun: false },
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized?.outcome).toBe("cancelled");
  });

  it("allows a user cancellation during generation to retain well-defined partial timing metrics", () => {
    const valid = buildValid();
    const sanitized = sanitizeModelBenchmarkResult({
      ...valid,
      stage: "generating",
      outcome: "cancelled",
      firstToken: { firstTokenTimeMs: 280 },
      generation: { tokenCountConfidence: "unavailable", generationDurationMs: 1500 },
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized?.firstToken.firstTokenTimeMs).toBe(280);
  });
});

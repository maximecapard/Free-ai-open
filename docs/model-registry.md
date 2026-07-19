# Model registry

`@free-ai-open/model-registry` owns model metadata and validation. Registry data is technical metadata only: it must never contain prompts, responses, documents, conversation content, credentials, signed URLs, or private local paths.

## Current state

Model Registry v2 contains five curated records verified with `@mlc-ai/web-llm` `0.2.84`:

| Registry ID | WebLLM model ID | Intended role | Download estimate | Runtime-memory estimate |
| --- | --- | --- | ---: | ---: |
| `smollm2-360m-instruct-q4f32` | `SmolLM2-360M-Instruct-q4f32_1-MLC` | broad compatibility | 207 MB | 580 MB |
| `qwen3-0.6b-q4f16` | `Qwen3-0.6B-q4f16_1-MLC` | light multilingual use | 352 MB | 1.40 GB |
| `qwen3-1.7b-q4f16` | `Qwen3-1.7B-q4f16_1-MLC` | balanced multilingual use | 984 MB | 2.04 GB |
| `qwen2.5-coder-1.5b-q4f16` | `Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC` | coding-focused use | 880 MB | 1.63 GB |
| `qwen3-4b-q4f16` | `Qwen3-4B-q4f16_1-MLC` | capable desktop use | about 2.28 GB | 3.43 GB |

Download estimates describe model artifacts, while runtime-memory estimates come from WebLLM's `vram_required_MB` metadata. They are different measurements and neither predicts model-weight bytes, KV-cache growth, total browser memory, or operating-system memory use. No separate model-weight byte estimate is claimed. The 4B download estimate has medium confidence; the other listed download estimates have high confidence. All installed records were loaded with WebLLM's 4,096-token context override on a desktop-class test environment, but the smoke run was not a full 4,096-token context stress test; larger upstream context claims are not exposed by this registry.

The active v0.7 adaptive router reads these records and drives client-side model loading through `AppRuntimeProvider`. The verified compact SmolLM2 record remains the pre-disclosed compatibility fallback. A different uncached model is never downloaded solely because the router selected it: the user must confirm the disclosed model name and approximate size first.

## V2 contract

Each `ModelRegistryRecord` includes:

- schema, registry, internal, and exact WebLLM identifiers;
- verification status, date, and WebLLM version;
- quantization and parameter class;
- independently sourced download and runtime-memory estimates with confidence;
- ordered compatibility, balanced, and performance context presets;
- explicit `0`-`5` task, form-factor, and performance-mode suitability scores;
- conservative English, French, and multilingual support levels;
- minimum WebGPU feature/limit and fallback-adapter requirements;
- known limitations;
- upstream source, MLC artifact, WebLLM library, and license URLs;
- ordered fallback model IDs.

`modelRegistryV2Schema` rejects unknown fields, malformed metadata, duplicate internal or WebLLM IDs, missing fallback targets, and fallback cycles. Only records with `status: "verified"`, a verification date, and a matching WebLLM version are eligible for automatic routing. Experimental, deprecated, and unavailable records remain excluded.

## Verification and licensing

The browser checks and their limits are recorded in [model-verification.md](model-verification.md). Model origins and licenses are recorded in [model-attributions.md](model-attributions.md). A successful smoke test is evidence for one browser/device class, not a guarantee for every browser, GPU, driver, language, or workload.

## Adding or changing a model

1. Confirm that the exact `webllmModelId`, model URL, model library URL, required features, and runtime-memory estimate exist in the installed WebLLM `prebuiltAppConfig`.
2. Verify the upstream source and license. Do not infer a license from another model size in the same family.
3. Record artifact size and runtime-memory estimates separately, with source and confidence.
4. Score every task, form factor, performance mode, and language conservatively. Unknown support must remain `unknown`, limited, or low-scored rather than guessed.
5. Keep the record experimental until browser loading, English completion, any claimed French behavior, Stop/recovery, and a post-recovery completion have been tested.
6. Add or update the public verification matrix and attribution table.
7. Run `pnpm --filter @free-ai-open/model-registry typecheck` and `pnpm --filter @free-ai-open/model-registry test`.

Do not add a model solely because it exists upstream. Its exact WebLLM artifact, source, license, compatibility metadata, and browser behavior must be verified first.

## Candidates not included

- `SmolLM2-135M-Instruct-q0f32-MLC`: retained only as historical Phase 0 test context, not as the normal v2 compatibility choice; the verified 360M q4 variant is still compact and offers a more credible baseline.
- `Qwen2.5-Coder-3B-Instruct` variants: excluded because the reviewed upstream 3B model uses the Qwen Research license rather than the Apache-2.0 license of the selected 1.5B variant.
- Larger Qwen3 variants such as 8B: excluded from this small alpha registry because their download/runtime requirements were outside the practical verification scope.
- Additional quantization variants of the same models: excluded to avoid a catalog of near-duplicates before the router and supported-device matrix can justify them.

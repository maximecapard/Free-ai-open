# Model registry

The model registry is the source of truth for model metadata used by routing,
manual selection, compatibility warnings, and future debug views. It is metadata
only. It must never contain user prompts, model responses, documents, API keys,
tokens, or private local paths.

Every model record must include:

- `id`
- `displayName`
- `technicalName`
- `source`
- `modelUrl`
- `tasks`
- `minDeviceTier`
- `recommendedDeviceTier`
- `estimatedDownloadGb`
- `estimatedRamGb`
- `backend`
- `license`
- `verified`
- `sha256` when available
- `status`

## Field guidance

- `id`: lowercase stable slug, for example `sample-general-light`.
- `displayName`: user-facing name shown in the app.
- `technicalName`: upstream or implementation-oriented model name.
- `source`: one of `huggingface`, `r2`, `local`, or `custom`.
- `modelUrl`: must use `hf://`, `https://`, `local://`, or `custom://`.
- `tasks`: one or more supported task categories from `packages/types`.
- `minDeviceTier`: lowest tier where the model is allowed to run.
- `recommendedDeviceTier`: preferred tier and must not be below `minDeviceTier`.
- `estimatedDownloadGb`: approximate download size in gigabytes.
- `estimatedRamGb`: approximate runtime RAM requirement in gigabytes.
- `backend`: one or more of `webgpu`, `wasm`, or `cpu`.
- `license`: SPDX identifier or clear license note. Use
  `verify-before-use` only for placeholders or unverified samples.
- `verified`: `true` only after browser validation.
- `sha256`: 64-character hex digest when a fixed artifact is known.
- `status`: `experimental`, `stable`, or `blocked`.

## Rules

- Do not mark a model stable until it has been tested in the browser.
- Do not redistribute models without checking the license.
- Do not use a mirror for a model unless the hash and source are documented.
- Advanced/manual users may select experimental models, but the UI must warn them.
- Keep sample records explicitly `experimental` until a real model has been
  validated in browser.
- Do not add secrets, signed URLs, access tokens, local file paths, or private
  infrastructure details to model metadata.
- Run the model-registry tests after adding or changing a model record.

## How to add a model

1. Add the record to `packages/model-registry/src/registry.ts`.
2. Include source, license, backend, estimated download size, estimated RAM,
   status, and compatibility metadata.
3. Keep `verified: false` and `status: "experimental"` until the model has
   been manually tested in the browser.
4. Add `sha256` when the exact model artifact is known and stable.
5. Run `pnpm --filter @free-ai-open/model-registry test`.

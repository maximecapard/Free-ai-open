# Model verification

This page records practical browser checks for Model Registry v2. It is intentionally narrower than a benchmark report: results describe one local run and do not guarantee performance or output quality on other devices.

## Environment and method

- Date: 2026-07-17.
- Runtime: `@mlc-ai/web-llm` `0.2.84`, Web Worker, WebGPU.
- Coarse environment: Chromium on Windows, desktop-class device.
- Input: synthetic, non-personal English and French smoke prompts.
- Per model: initial load, English completion, French completion, Stop after the first streamed fragment, worker/runtime replacement, cached reload, and post-recovery completion.
- Context: the installed 4,096-token override was active; these short prompts did not fill or stress-test the entire context window.
- Rate: approximate streamed fragments per second as counted by the existing runtime's technical `tokensPerSecond` metric. A fragment usually corresponds to a generated token but is not an independent tokenizer measurement.

No generated text, prompt text, raw GPU identifier, exact hardware identifier, or conversation was stored in this document.

## Results

| WebLLM model ID | Initial load | EN | FR | Approx. stream rate | Stop | Cached recovery reload | Post-recovery |
| --- | ---: | --- | --- | ---: | --- | ---: | --- |
| `SmolLM2-360M-Instruct-q4f32_1-MLC` | 7.4 s | pass | pass, limited claim | 3.1-14.6/s | pass | 1.2 s | pass |
| `Qwen3-0.6B-q4f16_1-MLC` | 8.5 s | pass | pass, usable claim | 9.1-13.3/s | pass | 2.0 s | pass |
| `Qwen3-1.7B-q4f16_1-MLC` | 18.0 s | pass | pass, usable claim | 7.2-7.6/s | pass | 4.6 s | pass |
| `Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC` | 14.2 s | pass | pass, limited claim | 1.0-3.1/s | pass | 3.9 s | pass |
| `Qwen3-4B-q4f16_1-MLC` | 34.2 s | pass | pass, usable claim | 2.7-3.1/s | pass | 9.0 s | pass |

`pass` means the operation completed in this environment. It is not a model-quality rating. French is never marked `strong` from this smoke test alone. Qwen3's upstream multilingual documentation plus successful basic French completion supports only the conservative `usable` registry value; SmolLM2 and Qwen2.5-Coder remain `limited` for French.

## Observed limitations

- Several Qwen3 short requests consumed much of the configured output budget. Existing generation limits and degenerate-output protection remain necessary.
- The 4B model had the largest download/runtime estimate and was substantially slower in this environment. It is scored desktop/performance-only rather than inferred suitable from system RAM alone.
- The coding model completed the general-language checks, but those checks do not establish strong general writing or French quality. Its non-coding suitability remains conservative.
- Cached reload timings do not guarantee that an artifact will remain cached; browser storage eviction and policy vary.
- Mobile Safari, Firefox, Android browsers, integrated GPUs, fallback adapters, and memory-constrained devices were not covered by this run. They remain release-test targets.

## Re-verification triggers

Re-run the matrix when the WebLLM version, exact model artifact, model library, context override, generation safety limits, worker lifecycle, or supported browser baseline changes. A record must leave automatic eligibility if its compatibility can no longer be substantiated.

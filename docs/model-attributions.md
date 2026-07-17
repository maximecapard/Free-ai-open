# Model attributions and licenses

FreeAI Open does not commit or redistribute model weights in this repository. When the user loads a model, WebLLM downloads the selected artifact from its documented model source and caches it under browser policy. Model licenses remain the responsibility of their upstream authors and users must review them for their intended use.

| Registry model | MLC/WebLLM artifact | Upstream model | License |
| --- | --- | --- | --- |
| SmolLM2 360M Instruct | [MLC artifact](https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC) | [HuggingFaceTB/SmolLM2-360M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct) | [Apache License 2.0](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/blob/main/LICENSE) |
| Qwen3 0.6B | [MLC artifact](https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC) | [Qwen/Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) | [Apache License 2.0](https://huggingface.co/Qwen/Qwen3-0.6B/blob/main/LICENSE) |
| Qwen3 1.7B | [MLC artifact](https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC) | [Qwen/Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) | [Apache License 2.0](https://huggingface.co/Qwen/Qwen3-1.7B/blob/main/LICENSE) |
| Qwen2.5-Coder 1.5B Instruct | [MLC artifact](https://huggingface.co/mlc-ai/Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC) | [Qwen/Qwen2.5-Coder-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct) | [Apache License 2.0](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct/blob/main/LICENSE) |
| Qwen3 4B | [MLC artifact](https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC) | [Qwen/Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B) | [Apache License 2.0](https://huggingface.co/Qwen/Qwen3-4B/blob/main/LICENSE) |

The registry pins exact WebLLM model IDs and model-library URLs compatible with `@mlc-ai/web-llm` `0.2.84`. Upstream repositories, artifacts, and licenses can change independently; re-verification is required before changing a model record or redistributing any artifact. This page is technical attribution, not legal advice.

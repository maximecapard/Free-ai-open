import { addLocalLog } from "@free-ai-open/local-logs";
import type { LocalLogInput } from "@free-ai-open/local-logs";

// @free-ai-open/local-logs validates modelId as lowercase-only and errorCode
// as either UPPER_SNAKE_CASE or a lowercase dotted/hyphenated slug. Runtime
// model IDs (e.g. WebLLM's "SmolLM2-360M-Instruct-q4f32_1-MLC") and our
// RuntimeErrorCode values (e.g. "webgpu_unavailable") match neither shape,
// so a record containing either as-is would silently fail validation and
// never be stored. Normalize both before handing them to addLocalLog.
export function toLocalLogModelId(modelId: string): string {
  return modelId.toLowerCase();
}

export function toLocalLogErrorCode(code: string): string {
  return code.toUpperCase();
}

// Never throws: @free-ai-open/local-logs already swallows its own storage
// and validation failures and resolves to null instead of rejecting.
export function recordLocalLog(input: LocalLogInput): void {
  void addLocalLog(input);
}

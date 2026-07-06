export interface GenerationSafetyLimits {
  maxTokens: number;
  maxDurationMs: number;
  maxOutputCharacters: number;
  maxUnbrokenSequenceCharacters: number;
  maxRepeatedCharacterRun: number;
  maxRepeatedSymbolBlockRun: number;
}

export type DegenerateOutputReason =
  | "output_too_long"
  | "unbroken_sequence"
  | "repeated_character"
  | "repeated_symbol_block";

export interface DegenerateOutputDetection {
  detected: boolean;
  reason?: DegenerateOutputReason;
}

export const GENERATION_SAFETY_LIMITS: GenerationSafetyLimits = {
  maxTokens: 768,
  maxDurationMs: 90_000,
  maxOutputCharacters: 12_000,
  maxUnbrokenSequenceCharacters: 240,
  maxRepeatedCharacterRun: 80,
  maxRepeatedSymbolBlockRun: 16,
};

const SYMBOL_BLOCK_PATTERN = /([!-/:-@[-`{-~]{2,8})\1{16,}/;

function detectRepeatedCharacterRun(output: string, maxRun: number): boolean {
  let previous = "";
  let runLength = 0;

  for (const character of output) {
    if (character === previous) {
      runLength += 1;
    } else {
      previous = character;
      runLength = 1;
    }

    if (runLength > maxRun) return true;
  }

  return false;
}

function detectLongUnbrokenSequence(output: string, maxLength: number): boolean {
  return output.split(/\s+/).some((segment) => segment.length > maxLength);
}

function detectRepeatedSymbolBlock(output: string, maxRun: number): boolean {
  const match = SYMBOL_BLOCK_PATTERN.exec(output);
  if (!match) return false;

  const block = match[1] ?? "";
  if (block.length === 0) return false;
  return Math.floor(match[0].length / block.length) > maxRun;
}

export function detectDegenerateOutput(
  output: string,
  limits: GenerationSafetyLimits = GENERATION_SAFETY_LIMITS
): DegenerateOutputDetection {
  if (output.length > limits.maxOutputCharacters) {
    return { detected: true, reason: "output_too_long" };
  }

  if (detectLongUnbrokenSequence(output, limits.maxUnbrokenSequenceCharacters)) {
    return { detected: true, reason: "unbroken_sequence" };
  }

  if (detectRepeatedCharacterRun(output, limits.maxRepeatedCharacterRun)) {
    return { detected: true, reason: "repeated_character" };
  }

  if (detectRepeatedSymbolBlock(output, limits.maxRepeatedSymbolBlockRun)) {
    return { detected: true, reason: "repeated_symbol_block" };
  }

  return { detected: false };
}

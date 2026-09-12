// Merges a Continue attempt's newly generated text onto the prior content it
// extends, removing an exact overlap if the model repeats the tail of what
// it already wrote (a real, common behavior when asked to "continue from
// here" -- see AppRuntimeProvider.tsx's continueGeneration and
// buildContinuationPrompt()). Deliberately conservative: it only removes an
// EXACT character-for-character suffix/prefix match, never a fuzzy or
// semantic one, and never touches repeated text that appears elsewhere in
// priorContent -- only an overlap at the exact join point is a duplicate;
// identical code appearing again later in a real answer is legitimate
// content, not an artifact of continuing.
//
// For a fresh (non-continuation) generation, priorContent is always "" and
// this function reduces to `"" + generatedDelta` unchanged, since an empty
// string has no suffix to overlap with anything -- the same merge function
// is used uniformly for both cases (see AppRuntimeProvider.tsx's shared
// generation accumulator).
const DEFAULT_MAX_OVERLAP_WINDOW = 400;

// A short match -- a shared word like "the", a shared token like "});", a
// shared space or punctuation mark -- is not reliably a duplicated-
// continuation artifact: it can just as easily be legitimate text that
// genuinely starts the same way the prior content happened to end (common
// in prose, and in code full of short repeated tokens like "});", "return",
// "end", or single-letter identifiers). Deleting it would silently destroy
// real content, which is strictly worse than leaving a rare, harmless
// duplicated word or token in place. 24 characters is long enough that a
// coincidental match becomes implausible -- it approximately means an
// entire short clause, a full short code statement, or a complete short
// line matched EXACTLY -- while still catching the real, common case this
// function exists for (the model re-emitting a whole prior line/sentence
// verbatim before continuing). When in doubt, this function keeps the
// repetition rather than risking a destructive deletion.
const MIN_OVERLAP_LENGTH = 24;

export function mergeContinuationOverlap(
  priorContent: string,
  generatedDelta: string,
  maxOverlapWindow: number = DEFAULT_MAX_OVERLAP_WINDOW
): string {
  if (priorContent.length === 0 || generatedDelta.length === 0) {
    return priorContent + generatedDelta;
  }

  const window = Math.min(maxOverlapWindow, priorContent.length, generatedDelta.length);
  if (window < MIN_OVERLAP_LENGTH) {
    return priorContent + generatedDelta;
  }

  // Longest exact suffix of priorContent that matches a prefix of
  // generatedDelta, searched from the longest possible overlap down to
  // MIN_OVERLAP_LENGTH, within the bounded window -- so the largest genuine
  // overlap wins, and a trivial coincidental match never triggers a false
  // trim.
  for (let length = window; length >= MIN_OVERLAP_LENGTH; length -= 1) {
    if (priorContent.endsWith(generatedDelta.slice(0, length))) {
      return priorContent + generatedDelta.slice(length);
    }
  }

  return priorContent + generatedDelta;
}

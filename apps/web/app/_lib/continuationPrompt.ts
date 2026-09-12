import type { RuntimeLocale } from "@free-ai-open/ai-runtime";

// The runtime only ever sees a single "prompt" string per generate() call
// (see packages/ai-runtime/src/runtime.ts's generate() -- it does not read
// prior turns from conversationId), so a Continue request has to restate
// both the original request and everything produced so far itself, plus an
// explicit instruction not to repeat it. This composed string is sent to
// the model only -- it is never persisted as a message (see
// AppRuntimeProvider.tsx's continueGeneration, which only ever persists the
// resulting extended assistant content via updateMessageContent).
export function buildContinuationPrompt(originalPrompt: string, partialContent: string, locale: RuntimeLocale): string {
  const instruction =
    locale === "fr"
      ? "Continue ta reponse precedente exactement la ou elle s'est arretee. Ne repete pas ce qui a deja ete ecrit et ne redemarre pas depuis le debut."
      : "Continue your previous response exactly where it left off. Do not repeat what has already been written and do not restart from the beginning.";
  return [
    `Original request: ${originalPrompt}`,
    "",
    "Your previous response so far (incomplete):",
    partialContent,
    "",
    instruction,
  ].join("\n");
}

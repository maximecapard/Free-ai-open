import { hasModelInCache } from "@mlc-ai/web-llm";

// Detects whether a model's weights are already in the browser's Cache
// Storage from a previous download, so a caller (the adaptive router
// integration) can decide whether switching to it needs a fresh download
// disclosure or can proceed immediately. Never guesses from registry
// metadata alone — this is a real local cache lookup. Defaults to `false`
// (i.e. "assume a download is needed") on any failure, since that is the
// safer direction: it triggers a disclosure the user can accept rather than
// silently starting an undisclosed download.
export async function isModelCached(modelId: string): Promise<boolean> {
  try {
    return await hasModelInCache(modelId);
  } catch {
    return false;
  }
}

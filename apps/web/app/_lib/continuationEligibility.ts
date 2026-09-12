import type { ChatMessageItem } from "../_components/ChatTranscript";
import { isReasoningInterrupted, segmentReasoning } from "./reasoningSegmentation";

// A message is eligible for the Continue action when it is visibly
// incomplete in either of the two ways FreeAI Open can know that: an
// explicit "incomplete" status recorded at persistence time (a length/
// stall/safety-limit interruption -- see generationPersistence.ts), or --
// for a message persisted before that status field existed, including
// every real historical conversation exported before this feature shipped
// -- a <think> block that is still open with no generation currently
// active (see reasoningSegmentation.ts). Both mean the same thing to the
// reader: the reply stops mid-thought with no final answer, so both should
// offer the same Continue action rather than only the newer of the two.
export function isMessageContinuable(
  message: Pick<ChatMessageItem, "role" | "content" | "status" | "incompleteReason">
): boolean {
  if (message.role !== "assistant") return false;
  // Item 10 (second Codex review): a message truncated to fit the local
  // 64k storage ceiling is already at the hard limit -- any further
  // content a continuation generates would just be re-truncated back to
  // the same ceiling by updateMessageContent(), so offering Continue here
  // would be confusing at best (it can look like nothing happened) and is
  // never actually useful.
  if (message.incompleteReason === "truncated") return false;
  if (message.status === "incomplete") return true;
  return isReasoningInterrupted(segmentReasoning(message.content), false);
}

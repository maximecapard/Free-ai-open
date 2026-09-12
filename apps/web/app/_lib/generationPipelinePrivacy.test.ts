import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

// A structural guard, mirroring MessageContent.test.tsx's and
// ReasoningDisclosure.test.tsx's equivalent checks, extended to the v0.7.1
// generation-accumulator/continuation/context-budget pipeline added by this
// review pass: none of it may ever log generated content, reasoning, or the
// composed continuation prompt. AppRuntimeProvider.tsx legitimately calls
// recordModelPerformanceObservation/logEvent-style helpers for TECHNICAL
// metrics elsewhere in the file, so this only asserts those calls are never
// passed anything derived from message content -- checked by scanning the
// actual source text for calls that would need to embed content directly
// (console.*, a raw logEvent/addLocalLog call, or serializing accumulator
// fields like mergedContent/generatedDelta/priorContent into a log call).
describe("generation pipeline privacy", () => {
  const files = [
    "../_runtime/AppRuntimeProvider.tsx",
    "./continuationMerge.ts",
    "./continuationPrompt.ts",
    "./continuationEligibility.ts",
    "./continuationExecution.ts",
    "./watchdogRecovery.ts",
    "./generationBudget.ts",
    "./generationPersistence.ts",
    "./reasoningSegmentation.ts",
  ].map((path) => ({ path, source: readSource(path) }));

  it("never calls console.* anywhere in the generation/continuation pipeline", () => {
    for (const { path, source } of files) {
      expect(source, `${path} must not call console.*`).not.toMatch(/console\.\w+\(/);
    }
  });

  it("never passes accumulator/continuation content fields to a log call", () => {
    const dangerousArgs = ["mergedContent", "generatedDelta", "priorContent", "continuationPrompt", "assistantText", "finalContent"];
    for (const { path, source } of files) {
      for (const line of source.split("\n")) {
        if (!/logEvent\(|addLocalLog\(|recordLocalLog\(/.test(line)) continue;
        for (const dangerous of dangerousArgs) {
          expect(line, `${path}: a logging call must not reference ${dangerous}`).not.toContain(dangerous);
        }
      }
    }
  });

  it("item 12 (mandatory): the second-review continuation/watchdog/context-budget extraction introduces no new network call of any kind", () => {
    // These three files (continuationExecution.ts, watchdogRecovery.ts,
    // generationBudget.ts) are new this review round -- everything they do
    // is local persistence (@free-ai-open/conversation-store) and local
    // computation, exactly like the code they were extracted from. No
    // fetch/XHR/WebSocket/sendBeacon call site should exist anywhere in
    // this pipeline now or in the future.
    const networkApiPattern = /\bfetch\(|new\s+XMLHttpRequest\(|new\s+WebSocket\(|navigator\.sendBeacon\(/;
    for (const { path, source } of files) {
      expect(source, `${path} must not perform any network call`).not.toMatch(networkApiPattern);
    }
  });
});

// Pure copy-to-clipboard logic, decoupled from CodeBlock.tsx's rendering so
// it can be tested without a DOM (this repo's default test environment has
// no jsdom/browser globals). Never logs or persists the copied text — see
// AGENTS.md's forbidden-fields rule; only the outcome is observable.
export type CodeCopyOutcome = "copied" | "error";

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

export async function copyCodeToClipboard(
  code: string,
  clipboard: ClipboardLike | undefined | null
): Promise<CodeCopyOutcome> {
  if (!code) return "error";
  if (!clipboard || typeof clipboard.writeText !== "function") return "error";

  try {
    await clipboard.writeText(code);
    return "copied";
  } catch {
    return "error";
  }
}

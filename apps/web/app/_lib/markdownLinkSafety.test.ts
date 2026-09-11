import { describe, expect, it } from "vitest";
import { isSafeMarkdownUrl, sanitizeMarkdownUrl } from "./markdownLinkSafety";

describe("sanitizeMarkdownUrl", () => {
  it("allows http, https, and mailto URLs", () => {
    expect(sanitizeMarkdownUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(sanitizeMarkdownUrl("http://example.com")).toBe("http://example.com");
    expect(sanitizeMarkdownUrl("mailto:hello@example.com")).toBe("mailto:hello@example.com");
  });

  it("rejects javascript: URLs", () => {
    expect(sanitizeMarkdownUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeMarkdownUrl("  javascript:alert(1)  ")).toBe("");
    expect(sanitizeMarkdownUrl("JavaScript:alert(1)")).toBe("");
  });

  it("rejects data:, vbscript:, and file: URLs", () => {
    expect(sanitizeMarkdownUrl("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(sanitizeMarkdownUrl("vbscript:msgbox(1)")).toBe("");
    expect(sanitizeMarkdownUrl("file:///etc/passwd")).toBe("");
  });

  it("rejects relative and protocol-relative URLs rather than resolving them against the app origin", () => {
    expect(sanitizeMarkdownUrl("/settings")).toBe("");
    expect(sanitizeMarkdownUrl("//evil.example.com")).toBe("");
    expect(sanitizeMarkdownUrl("relative/path")).toBe("");
    expect(sanitizeMarkdownUrl("#section")).toBe("");
  });

  it("rejects empty or whitespace-only input", () => {
    expect(sanitizeMarkdownUrl("")).toBe("");
    expect(sanitizeMarkdownUrl("   ")).toBe("");
  });

  it("trims surrounding whitespace from an otherwise-safe URL", () => {
    expect(sanitizeMarkdownUrl("  https://example.com  ")).toBe("https://example.com");
  });
});

describe("isSafeMarkdownUrl", () => {
  it("mirrors sanitizeMarkdownUrl's allow/reject decision", () => {
    expect(isSafeMarkdownUrl("https://example.com")).toBe(true);
    expect(isSafeMarkdownUrl("javascript:alert(1)")).toBe(false);
  });
});

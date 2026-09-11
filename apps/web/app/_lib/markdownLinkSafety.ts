// Model-generated Markdown can contain arbitrary link targets. Only a small
// allowlist of schemes is ever safe to navigate to from rendered chat
// content; everything else (javascript:, data:, vbscript:, file:, bare
// relative paths, protocol-relative URLs, empty strings) is rejected.
// Rejected URLs resolve to "" — react-markdown's own convention for a
// neutralized link (see defaultUrlTransform) — so callers can render the
// link text as plain, non-clickable content instead of a dead/dangerous
// anchor.
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function sanitizeMarkdownUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  let parsed: URL;
  try {
    // No base is supplied on purpose: this rejects every relative/
    // protocol-relative URL rather than resolving it against the app's own
    // origin, since a model has no legitimate reason to link back into the
    // app itself.
    parsed = new URL(trimmed);
  } catch {
    return "";
  }

  return ALLOWED_URL_SCHEMES.has(parsed.protocol) ? trimmed : "";
}

export function isSafeMarkdownUrl(rawUrl: string): boolean {
  return sanitizeMarkdownUrl(rawUrl) !== "";
}

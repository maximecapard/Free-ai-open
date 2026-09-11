import { isValidElement, memo, type AnchorHTMLAttributes, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { sanitizeMarkdownUrl } from "../_lib/markdownLinkSafety";
import { CodeBlock } from "./CodeBlock";

export interface MessageContentProps {
  content: string;
}

// Renders assistant Markdown as real structured elements instead of raw
// syntax. This is a presentation-only concern: the persisted/exported
// message content (see conversationMessages.ts, @free-ai-open/conversation-
// export) is always the original plain Markdown source string — nothing
// here ever rewrites it.
//
// Security model (see docs/security.md's "Markdown rendering" section):
// - No rehype-raw / rehype-sanitize plugin is used, so raw HTML found in the
//   Markdown source (a <script>, an onerror= attribute, a <style> block) is
//   never parsed into real DOM nodes by react-markdown — it is dropped
//   during the markdown-AST -> hast conversion. dangerouslySetInnerHTML is
//   never used anywhere in this component.
// - Every link/image URL goes through sanitizeMarkdownUrl(), an allowlist of
//   http:/https:/mailto: only; anything else (javascript:, data:, a bare
//   relative path) resolves to an empty, non-clickable target.
// - Images are intentionally NOT rendered as <img> at all (see the `img`
//   override below): loading an image is a real network request the browser
//   makes on the model's say-so, which this privacy-first app never wants
//   to trigger implicitly. The link text/URL is shown as plain safe text
//   instead.
function extractPlainText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractPlainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractPlainText(node.props.children);
  return "";
}

function LinkRenderer({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safeHref = href ? sanitizeMarkdownUrl(href) : "";
  if (!safeHref) return <span className="chat-message-link-disabled">{children}</span>;

  return (
    <a {...rest} href={safeHref} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

// Overriding only `pre` (not `code`) lets react-markdown produce its normal
// default <code> element first; this override then reads that element's
// `className` (carries `language-xxx` for a fenced block, absent for plain
// text) and text content to build a CodeBlock, and never renders the
// default <pre>/<code> pair for the block case. True inline code (never
// wrapped in a <pre>) is untouched here and keeps its own `code` styling.
function PreRenderer({ children }: { children?: ReactNode }) {
  if (isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    const language = /language-(\S+)/.exec(children.props.className ?? "")?.[1];
    const code = extractPlainText(children.props.children).replace(/\n$/, "");
    return <CodeBlock code={code} language={language} />;
  }

  return <pre className="chat-code-block__pre">{children}</pre>;
}

function InlineCodeRenderer({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <code className={["chat-inline-code", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </code>
  );
}

// Images are deliberately not rendered as <img> — see the module doc above.
function ImageRenderer({ alt, src }: { alt?: string; src?: unknown }) {
  const safeSrc = typeof src === "string" && src ? sanitizeMarkdownUrl(src) : "";
  if (!safeSrc) return alt ? <span className="chat-message-link-disabled">{alt}</span> : null;

  return (
    <a href={safeSrc} target="_blank" rel="noopener noreferrer nofollow">
      {alt || safeSrc}
    </a>
  );
}

// GFM tables can be wider than the chat column; wrap in a horizontally
// scrollable container so a long table never forces page-wide overflow.
function TableRenderer({ children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="chat-markdown-table-scroll">
      <table {...rest}>{children}</table>
    </div>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  a: LinkRenderer,
  pre: PreRenderer,
  code: InlineCodeRenderer,
  img: ImageRenderer,
  table: TableRenderer,
};

// remark-breaks turns a single newline into a visible <br> instead of
// CommonMark's default "soft break renders as a space." Local model output
// is often not blank-line-separated between short lines; without this, that
// structure would visually collapse — a regression from the previous plain
// `white-space: pre-wrap` rendering, which showed every newline.
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

export const MessageContent = memo(function MessageContent({ content }: MessageContentProps) {
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
        urlTransform={sanitizeMarkdownUrl}
        skipHtml
      >
        {content}
      </Markdown>
    </div>
  );
});

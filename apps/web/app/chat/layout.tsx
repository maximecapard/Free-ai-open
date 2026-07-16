// Scopes the fixed-height, independently-scrolling application workspace to
// the /chat route only (see ".chat-shell" in globals.css). Every other
// route keeps the normal document-flow page scrolling from the root layout;
// this file exists so that behavior never leaks outside /chat.
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <div className="chat-shell">{children}</div>;
}

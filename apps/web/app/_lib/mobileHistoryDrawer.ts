export type MobileHistoryDrawerAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "select-conversation" }
  | { type: "new-chat" }
  | { type: "escape" }
  | { type: "backdrop-click" }
  | { type: "viewport-desktop" };

// The mobile history drawer's entire state is whether it's open. Actions are
// kept distinct (rather than collapsing everything into a generic "close")
// so each required closing trigger — selection, new chat, Escape, backdrop,
// desktop viewport — is independently testable and documented.
export function mobileHistoryDrawerReducer(isOpen: boolean, action: MobileHistoryDrawerAction): boolean {
  switch (action.type) {
    case "open":
      return true;
    case "close":
    case "select-conversation":
    case "new-chat":
    case "escape":
    case "backdrop-click":
    case "viewport-desktop":
      return false;
    default:
      return isOpen;
  }
}

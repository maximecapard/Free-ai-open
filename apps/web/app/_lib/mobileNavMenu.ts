export type MobileNavMenuAction = { type: "open" } | { type: "close" } | { type: "toggle" };

// Pure state transition for the mobile app-shell top bar's small dropdown
// menu (Home/Chat/Settings/Debug links plus language/theme toggles). Kept
// separate from Header.tsx so it's independently testable, matching the
// mobileHistoryDrawerReducer pattern used by the chat history drawer.
export function mobileNavMenuReducer(isOpen: boolean, action: MobileNavMenuAction): boolean {
  switch (action.type) {
    case "open":
      return true;
    case "close":
      return false;
    case "toggle":
      return !isOpen;
    default:
      return isOpen;
  }
}

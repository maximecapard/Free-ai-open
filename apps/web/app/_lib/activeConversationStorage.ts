// Persists only a conversation ID pointer (never conversation content) so the
// chat page can resume the last-viewed conversation after a page refresh.
const STORAGE_KEY = "free-ai-open:active-conversation-id";

export function getStoredActiveConversationId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredActiveConversationId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage may be unavailable (private browsing, quota, disabled). The
    // chat still works; it just won't auto-resume after a refresh.
  }
}

export function clearStoredActiveConversationId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

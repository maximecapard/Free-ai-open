"use client";

import { useEffect, useState } from "react";

// v0.7.0-alpha Phase 5: "offline and model not cached" empty state — lets
// the chat error banner distinguish "you're offline" from a generic model
// failure when a download was needed. Starts true (assume online) to match
// server-rendered markup and avoid a hydration mismatch from branching on a
// browser-only API during the initial render, then corrects itself once
// mounted.
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

"use client";

import { useEffect, useState } from "react";

/** Slim offline indicator (docs/overview). Check-ins still work offline. */
export function NetworkBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="sticky top-0 z-50 bg-secondary px-4 py-1.5 text-center text-xs text-secondary-foreground">
      You&apos;re offline — check-ins will sync when you reconnect.
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getPushStatus,
  listenForegroundMessages,
  syncPushToken,
} from "@/lib/push";

interface Toast {
  title: string;
  body: string;
  targetUrl: string;
}

/**
 * Mounted on signed-in pages: refreshes the FCM token when permission is
 * already granted, and surfaces foreground pushes as an in-app toast.
 */
export function PushProvider({ uid }: { uid: string }) {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPushStatus().then((status) => {
      if (status === "granted" && !cancelled) {
        syncPushToken(uid).catch((err) =>
          console.error("push token refresh failed:", err)
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    listenForegroundMessages((payload) => {
      setToast(payload);
      setTimeout(() => setToast((t) => (t === payload ? null : t)), 6000);
    }).then((fn) => {
      if (cancelled) fn();
      else unsubscribe = fn;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (!toast) return null;
  return (
    <button
      onClick={() => {
        router.push(toast.targetUrl);
        setToast(null);
      }}
      className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl border bg-card p-4 text-left shadow-lg"
    >
      <p className="text-sm font-semibold">{toast.title}</p>
      {toast.body && (
        <p className="mt-0.5 text-sm text-muted-foreground">{toast.body}</p>
      )}
    </button>
  );
}

"use client";

import { doc, setDoc } from "firebase/firestore";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { getClientApp, getClientDb } from "@/lib/firebase/client";

export type PushStatus =
  | "unsupported" // browser can't do web push (e.g. iOS Safari outside a PWA)
  | "default" // supported, not yet asked
  | "denied"
  | "granted";

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's non-standard flag
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!(await isSupported().catch(() => false))) return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as PushStatus;
}

/**
 * Fetches the current FCM token (using our Serwist service worker) and
 * stores it on the user doc. Call when permission is already granted —
 * on app load for refresh, and right after a successful request.
 */
export async function syncPushToken(uid: string): Promise<void> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.warn("NEXT_PUBLIC_FIREBASE_VAPID_KEY not set; push disabled");
    return;
  }
  // getRegistration (not .ready) — .ready never resolves when no SW is
  // registered, e.g. in dev where Serwist is disabled.
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const messaging = getMessaging(getClientApp());
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (token) {
    await setDoc(
      doc(getClientDb(), "users", uid),
      { fcmToken: token, pwaInstalled: isStandalone() },
      { merge: true }
    );
  }
}

/** Requests permission, then registers + stores the token. */
export async function enablePush(uid: string): Promise<PushStatus> {
  const status = await getPushStatus();
  if (status === "unsupported" || status === "denied") return status;
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    await syncPushToken(uid);
  }
  return permission as PushStatus;
}

/**
 * Foreground messages — our service worker posts pushes to the focused
 * window (see sw.ts) instead of showing a system notification. (FCM's
 * onMessage only works with FCM's own worker, which we don't use.)
 */
export function listenForegroundMessages(
  onNotification: (payload: {
    title: string;
    body: string;
    targetUrl: string;
  }) => void
): () => void {
  if (!("serviceWorker" in navigator)) return () => {};
  const handler = (event: MessageEvent) => {
    if (event.data?.type !== "PUSH_MESSAGE") return;
    const { title, body, targetUrl } = event.data.payload ?? {};
    onNotification({
      title: title ?? "Habitual",
      body: body ?? "",
      targetUrl: targetUrl ?? "/dashboard",
    });
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

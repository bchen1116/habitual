"use client";

import { doc, setDoc } from "firebase/firestore";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
} from "firebase/messaging";
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
  const registration = await navigator.serviceWorker.ready;
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

/** Foreground messages (page open) — surface as an in-app toast. */
export async function listenForegroundMessages(
  onNotification: (payload: {
    title: string;
    body: string;
    targetUrl: string;
  }) => void
): Promise<() => void> {
  if (!(await isSupported().catch(() => false))) return () => {};
  const messaging = getMessaging(getClientApp());
  return onMessage(messaging, (payload: MessagePayload) => {
    onNotification({
      title: payload.notification?.title ?? "Habitual",
      body: payload.notification?.body ?? "",
      targetUrl: payload.data?.targetUrl ?? "/dashboard",
    });
  });
}

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

/**
 * FCM web push, handled directly (no firebase SDK in the worker). The
 * server sends `webpush.notification` + `data.targetUrl`; we display and
 * route clicks ourselves.
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: {
    notification?: { title?: string; body?: string };
    data?: { targetUrl?: string };
  };
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  const title = payload.notification?.title ?? "Habitual";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.notification?.body,
      icon: "/icons/icon-192.png",
      data: { targetUrl: payload.data?.targetUrl ?? "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl: string = event.notification.data?.targetUrl ?? "/dashboard";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(targetUrl);
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});

"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import {
  enablePush,
  getPushStatus,
  isIosSafari,
  isStandalone,
  type PushStatus,
} from "@/lib/push";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CATEGORIES = [
  {
    key: "groupActivity",
    label: "Group activity",
    description: "Someone joined your challenge",
  },
  {
    key: "challengeLifecycle",
    label: "Challenge lifecycle",
    description: "Starting today, last-day reminders, results",
  },
  {
    key: "ledger",
    label: "Ledger",
    description: "New debts, and settlements owed to you",
  },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

export function NotificationSettings({ uid }: { uid: string }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);
  const [prefs, setPrefs] = useState<Partial<Record<CategoryKey, boolean>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushStatus().then(setStatus);
    setStandalone(isStandalone());
    setIosSafari(isIosSafari());
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(getClientDb(), "users", uid), (snap) => {
      setPrefs(snap.data()?.notificationPrefs ?? {});
    });
    return unsubscribe;
  }, [uid]);

  async function requestPermission() {
    setBusy(true);
    try {
      setStatus(await enablePush(uid));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: CategoryKey) {
    const next = !(prefs[key] ?? true);
    // Dot-path update on just this one nested field — not a read-modify
    // -write of the whole notificationPrefs map from the local `prefs`
    // closure. That version raced: two toggles in quick succession, before
    // the first write's onSnapshot round-trip updated `prefs`, meant the
    // second write's `{...prefs, [key]: next}` silently dropped the first
    // toggle's change (it was building from a stale `prefs`, not what had
    // just been written). A per-field update can't race with itself this
    // way — Firestore merges it into the map server-side.
    await updateDoc(doc(getClientDb(), "users", uid), {
      [`notificationPrefs.${key}`]: next,
    });
  }

  const pushBlocked =
    status === "unsupported" && iosSafari && !standalone;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Push notifications</CardTitle>
          <CardDescription>
            {status === null && "Checking support…"}
            {status === "granted" && "Enabled on this device."}
            {status === "default" &&
              "Get nudged for check-ins, results, and new debts."}
            {status === "denied" &&
              "Notifications are blocked in your browser settings. Re-enable them there, then reload."}
            {status === "unsupported" &&
              (pushBlocked
                ? "On iPhone and iPad, notifications only work after you add Habitual to your home screen: tap Share in Safari, then \"Add to Home Screen\", and come back here."
                : "This browser doesn't support web push.")}
          </CardDescription>
        </CardHeader>
        {status === "default" && (
          <CardContent>
            <Button onClick={requestPermission} disabled={busy}>
              {busy ? "Requesting…" : "Enable notifications"}
            </Button>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>What you get notified about</CardTitle>
          {status !== "granted" && (
            <CardDescription>
              These apply once notifications are enabled.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {CATEGORIES.map((category) => {
            const enabled = prefs[category.key] ?? true;
            return (
              <button
                key={category.key}
                role="switch"
                aria-checked={enabled}
                aria-label={category.label}
                onClick={() => toggle(category.key)}
                className="flex items-center justify-between gap-4 text-left"
              >
                <span>
                  <span className="block text-sm font-medium">
                    {category.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {category.description}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={
                    "relative h-6 w-10 shrink-0 rounded-full transition-colors " +
                    (enabled ? "bg-foreground" : "bg-secondary")
                  }
                >
                  <span
                    className={
                      "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all " +
                      (enabled ? "left-[1.125rem]" : "left-0.5")
                    }
                  />
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

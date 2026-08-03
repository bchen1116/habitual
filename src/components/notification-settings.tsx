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
import { browserTimezone } from "@/lib/dates";
import {
  NOTIFICATION_CATEGORIES,
  REMINDER_HOURS,
  formatHour,
  reminderHourFor,
  type NotificationCategory,
} from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function NotificationSettings({ uid }: { uid: string }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);
  const [prefs, setPrefs] = useState<Partial<Record<NotificationCategory, boolean>>>({});
  const [reminderHour, setReminderHour] = useState(reminderHourFor(undefined));
  // The stored timezone is the authority for day boundaries (docs/01), so the
  // reminder fires against that one — not whatever device is reading this
  // screen. Showing it is the difference between "10 PM" meaning something
  // and being a guess.
  const [timezone, setTimezone] = useState(browserTimezone());
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    getPushStatus().then(setStatus);
    setStandalone(isStandalone());
    setIosSafari(isIosSafari());
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(getClientDb(), "users", uid), (snap) => {
      const data = snap.data();
      setPrefs(data?.notificationPrefs ?? {});
      setReminderHour(reminderHourFor(data?.reminderHour));
      if (typeof data?.timezone === "string" && data.timezone) {
        setTimezone(data.timezone);
      }
    },
    (err) => {
      // Same treatment profile-editor already got: an unhandled listener
      // error here would leave the toggles silently showing defaults with
      // nothing said about it. Defaults are still the honest fallback —
      // absent prefs mean "on" server-side too — so the screen stays usable.
      console.error("notification settings listener failed:", err);
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

  /**
   * Optimistic, then corrected by the listener above. Awaiting the write
   * instead left the control motionless until Firestore acknowledged — and
   * motionless forever when it never did, since neither of these writes had
   * a rejection handler: a failed toggle looked exactly like a control that
   * doesn't work.
   */
  function save(patch: Record<string, unknown>, revert: () => void) {
    setSaveError(false);
    updateDoc(doc(getClientDb(), "users", uid), patch).catch((err) => {
      console.error("notification preference write failed:", err);
      revert();
      setSaveError(true);
    });
  }

  function saveReminderHour(hour: number) {
    const previous = reminderHour;
    setReminderHour(hour);
    save({ reminderHour: hour }, () => setReminderHour(previous));
  }

  function toggle(key: NotificationCategory) {
    const next = !(prefs[key] ?? true);
    const previous = prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    // Dot-path update on just this one nested field — not a read-modify
    // -write of the whole notificationPrefs map from the local `prefs`
    // closure. That version raced: two toggles in quick succession, before
    // the first write's onSnapshot round-trip updated `prefs`, meant the
    // second write's `{...prefs, [key]: next}` silently dropped the first
    // toggle's change (it was building from a stale `prefs`, not what had
    // just been written). A per-field update can't race with itself this
    // way — Firestore merges it into the map server-side. The optimistic
    // setPrefs above is display-only and can't reintroduce it.
    save({ [`notificationPrefs.${key}`]: next }, () =>
      setPrefs((p) => ({ ...p, [key]: previous }))
    );
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
          {saveError && (
            <p className="text-sm text-destructive">
              Couldn&apos;t save that change. Please try again.
            </p>
          )}
          {NOTIFICATION_CATEGORIES.map((category) => {
            const enabled = prefs[category.key] ?? true;
            return (
              <div key={category.key} className="flex flex-col gap-2.5">
              <Switch
                checked={enabled}
                onCheckedChange={() => toggle(category.key)}
                label={category.label}
              >
                <span>
                  <span className="block text-sm font-medium">
                    {category.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {category.description}
                  </span>
                </span>
              </Switch>
              {category.key === "dailyReminder" && enabled && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-secondary px-3 py-2.5">
                  <label htmlFor="reminder-hour" className="text-xs font-medium">
                    Nudge me at
                  </label>
                  <select
                    id="reminder-hour"
                    value={reminderHour}
                    onChange={(e) => saveReminderHour(Number(e.target.value))}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  >
                    {REMINDER_HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {formatHour(hour)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">
                    {timezone.replaceAll("_", " ")} — your day closes at midnight
                    there, and that&apos;s when each habit is fixed as done or
                    missed.
                  </span>
                </div>
              )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

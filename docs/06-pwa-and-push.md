# 06 — PWA & Push Notifications

**Goal:** make Habitual installable as a Progressive Web App, and deliver push notifications wherever the browser supports them. Push is the reason we care about PWA install (especially on iOS).

## What ships

- **PWA manifest** (name, icons, theme color, `display: standalone`)
- **Service worker** via Serwist (successor to `next-pwa`, works with Next.js App Router)
- **Install prompt** — custom UI + native `beforeinstallprompt` handling on supported browsers; iOS-specific instructions on Safari
- **Web push** via Firebase Cloud Messaging Web SDK
- **Notification permission request** flow (deferred until the user is interested, not on first visit)
- **Push events** for:
  - Someone joined your group challenge
  - Challenge starting today
  - Challenge ending in 24 hours (with pending check-ins)
  - Results are in
  - New ledger entry
  - Debt settled by counterparty
- **Notification settings** page: install status, permission status, per-category toggles

## What is *not* here

- **No email or SMS fallback.** Users who can't or won't grant push permission just see updates when they visit the site.
- **No local reminders.** Local notifications aren't a thing on the web outside of installed PWAs, and even there they're weak. Push covers reminders where possible.

## Data model changes

**`users/{uid}`** (updated)
```
fcmToken: string | null       # single token per user; refresh on session start
pwaInstalled: bool | null     # inferred client-side and reported
notificationPrefs: {
  groupActivity: bool
  challengeLifecycle: bool
  ledger: bool
  dailyReminder: bool         # the evening "anything unchecked?" nudge
}
reminderHour: number | null   # 16-23, local; absent means 22 (10 PM)
lastReminderYmd: string | null # yyyymmdd of the last evening nudge sent, so a
                               # redelivery can't buzz twice for one evening
notificationPromptShownAt: timestamp | null    # for "don't spam the prompt" logic
```

Multi-device support later: store an array of `fcmTokens`. Single token is fine for MVP.

## Browser support matrix

| Browser | Install | Web push |
|---|---|---|
| Chrome desktop | ✅ native prompt | ✅ |
| Chrome Android | ✅ native prompt | ✅ |
| Firefox desktop | ✅ (manual, from menu) | ✅ |
| Edge | ✅ | ✅ |
| Safari macOS | ✅ (macOS 14+) | ✅ |
| Safari iOS | ⚠️ manual only (Share → Add to Home Screen) | ⚠️ **only after PWA install** (iOS 16.4+) |

**Practical implication:** iOS users who don't install get no push. That's fine; the plan is to nudge them to install.

## Install prompt UX

- **Chromium browsers:** listen for `beforeinstallprompt`, save the event, show a custom install button somewhere prominent (dashboard banner, settings). Call `event.prompt()` when the user clicks.
- **iOS Safari:** no `beforeinstallprompt`. Detect iOS Safari + not-installed, show a small banner with "Add to Home Screen" instructions (Share icon → Add to Home Screen). Only show once every 7 days to avoid nagging.
- **Already installed:** hide the prompt (detect via `display-mode: standalone` media query).

Trigger points:
1. After 2nd visit
2. On the Notification settings page (as the way to enable push on iOS)
3. On dashboard as a small dismissible banner

## Push notification flow

1. **Request permission** — only after the user does something implying interest (opens notification settings, joins a group, first receives a debt). Never on first load.
2. **Get FCM token** — after permission granted, request from FCM Web SDK using the VAPID key.
3. **Store token** on user doc — server (Cloud Function) uses it to send push.
4. **Refresh token** — on session start, request current token; update user doc if changed.
5. **Handle incoming notifications:**
   - Foreground: intercept via `onMessage` and show an in-app toast
   - Background / closed: service worker handles it and shows the system notification
6. **Notification click:** service worker opens/focuses the app at the target URL (deep link via `data.targetUrl`)

## Backend (Cloud Functions)

Same triggers as before, but sending via **FCM Web** to the user's `fcmToken`:

1. **`onLedgerEntryCreate`** (Firestore trigger)
   - Push to `fromUid`: "New debt: $10 to [counterparty] from [challenge]"
   - If `toType == "user"`: push to `toUid`: "[fromName] owes you $10 from [challenge]"

2. **`onMemberJoin`** (Firestore trigger)
   - Push to other members: "[displayName] joined [challenge]"

3. **`onLedgerEntrySettle`** (Firestore trigger, status: unsettled → settled)
   - If `toType == "user"`: push to `toUid`: "[fromName] marked $10 as settled"

4. **`sendDailyLifecycleNotifications`** (scheduled hourly at :00 UTC)
   - Reads `users` grouped by `timezone`; one pass covers both hours below, so a
     user's timezone and challenge list are read once
   - For users whose local hour is 09:
     - Challenges starting today → "Your challenge '[name]' starts today"
     - Challenges ending tomorrow with pending check-ins → "Last day! Check in for [name]"
   - For users whose local hour is their own `reminderHour` (default 22):
     - One push covering every habit still unchecked today, or none at all.
       Anchored to the user's timezone because that is where the day actually
       closes — at local midnight each habit is fixed as done or missed.
     - A `weekly_count` habit whose window has already hit its target is left
       alone; the requirement comes from the same `windowRequirement` used by
       adjudication, so the nudge can never ask for a check-in the money layer
       doesn't want. Wording escalates only when today is the last day that can
       still keep the week whole.
     - `lastReminderYmd` guards against a double send for one local day.

5. **`adjudicateEndedChallenges`** (existing, extended)
   - After creating ledger entries, push to each member: "Results are in for [challenge]"

All sends respect the recipient's `notificationPrefs`. Sends skip users with `fcmToken == null`.

## PWA implementation

- Add `app/manifest.ts` (dynamic Next.js manifest route)
- Register service worker in `app/layout.tsx` on client mount
- Serwist handles precaching the app shell + runtime caching Firestore SDK JS
- Icons: 192×192, 512×512, and a maskable variant (with safe-area padding)
- Theme color and background color set in manifest

## Screens

- **Install prompt banner** — dashboard + settings
- **Notification settings** (`/settings/notifications`) — install status + button, permission status + button, per-category toggles

## Non-goals

- Rich notifications (images, action buttons)
- Notification history / inbox in-app
- Multi-device token management (single token per user for MVP)
- Email or SMS fallback

## Manual test checklist

- [ ] Chrome desktop: install banner appears; click installs; runs in standalone window
- [ ] Chrome desktop: permission request appears at the right moment; push works
- [ ] Chrome Android: install works; push works
- [ ] Firefox: install and push work
- [ ] Safari macOS: notifications work without install (macOS 14+)
- [ ] Safari iOS: "Add to Home Screen" banner appears with correct instructions
- [ ] Safari iOS after install: permission request appears; push works
- [ ] Safari iOS without install: no push (as expected); explanatory message in settings
- [ ] Someone joins your group: recipient gets push
- [ ] Ledger entry created: debtor + creditor (if user) get push
- [ ] Debt settled: creditor gets push
- [ ] Adjudication complete: all members get "Results in" push with correct deep link
- [ ] Toggle off "group activity": no more join notifications
- [ ] Deny permission: settings shows "Notifications are off. Re-enable in browser settings." + link
- [ ] Cold start via notification tap: opens correct URL
- [ ] Foreground notification: in-app toast shows

## Acceptance

- Habitual installs cleanly as a PWA on all supported platforms
- Push notifications fire correctly, honor per-category prefs
- iOS users who install can receive push; those who don't see a clear explanation
- Install prompt is not spammy (respects dismissals + platform detection)

# 06 — Push Notifications

**Goal:** add push notifications via FCM for group activity and challenge lifecycle events. Local reminders for check-ins (from step 2) remain — this step adds server-driven push on top.

## What ships

- FCM device tokens registered on user doc
- Push notifications for these events:
  - Someone joined your group challenge
  - Challenge starting today
  - Challenge ending in 24 hours (with pending check-ins)
  - Results are in (adjudication complete)
  - New debt added to your ledger
  - Someone settled a debt they owed you
- **Notification settings** screen with per-category toggles
- Tapping a notification deep-links into the relevant screen

## Data model changes

**`users/{uid}`** (updated)
```
fcmTokens: [string]              # user may have multiple devices; deduped
notificationPrefs: {
  checkinReminders: bool         # controls local reminders (from step 2)
  groupActivity: bool            # someone joined, someone checked in
  challengeLifecycle: bool       # starting, ending, results
  ledger: bool                   # new debt, someone settled
}
```

## Backend

**Cloud Functions:**

1. **`onLedgerEntryCreate`** (Firestore trigger on `ledgerEntries/{entryId}` create)
   - Send push to `fromUid` ("New debt: $10 to [counterparty] from [challenge]")
   - If `toType == "user"`: send push to `toUid` ("[fromName] owes you $10 from [challenge]")

2. **`onMemberJoin`** (Firestore trigger on `challenges/{cid}/members/{uid}` create)
   - Send push to all other members ("[displayName] joined [challenge]")

3. **`onLedgerEntrySettle`** (Firestore trigger on `ledgerEntries/{entryId}` update where status: unsettled → settled)
   - If `toType == "user"`: send push to `toUid` ("[fromName] marked $10 as settled")

4. **`sendDailyLifecycleNotifications`** (scheduled, 09:00 local user time)
   - Challenges starting today → "Your challenge '[name]' starts today"
   - Challenges ending tomorrow with pending check-ins → "Last day! Check in for [name]"

5. **`adjudicateEndedChallenges`** (existing, extended)
   - After creating ledger entries, send push to each member ("Results are in for [challenge]")

All push sends respect the recipient's `notificationPrefs`.

## Deep links

Each notification carries a payload:
```
{
  type: "challenge" | "ledger",
  targetId: string   # challengeId or entryId
}
```

Flutter handles the notification tap (foreground / background / cold start) and routes accordingly.

## Flutter dependencies (new)

```yaml
firebase_messaging
```

## Permission handling

- Request notification permission on first launch after sign-in (iOS requires explicit; Android 13+ requires POST_NOTIFICATIONS runtime permission).
- If denied, disable push toggles in settings and show a "Notifications are off in system settings" hint with a link.

## Screens

- **Permission prompt** — brief pre-permission modal explaining why (increases opt-in rate) before triggering system prompt
- **Notification settings** — new route under Profile; per-category toggles, system-permission status banner
- All existing screens: no changes; notifications route to them via deep links

## Non-goals

- Rich media (images) in notifications
- Notification action buttons (e.g., check in from the notification directly)
- In-app notification center / history
- SMS or email fallback
- Grouping notifications on the OS

## Manual test checklist

- [ ] Fresh install → permission prompt appears once → grant → token registered on user doc
- [ ] Two devices signed in as different users; user A creates group challenge; user B joins → user A receives push
- [ ] Adjudication runs → all members receive "Results in" push with correct deep link
- [ ] Ledger entry created → debtor receives push; if user-to-user, creditor also receives push
- [ ] Debtor marks entry settled → creditor receives push
- [ ] Challenge starting today → morning push at 09:00 local
- [ ] Challenge ending tomorrow with missed check-ins → push
- [ ] Toggle off "group activity" → no more join notifications
- [ ] Toggle off "ledger" → no more debt-related notifications
- [ ] Tap notification: cold start opens correct screen
- [ ] Tap notification: from foreground shows in-app snackbar and opens screen
- [ ] Deny system permission → toggles disabled with hint

## Acceptance

- All lifecycle events trigger correct notifications
- Notification prefs respected end-to-end
- Deep links work in all app states (foreground / background / terminated)
- No spam; no more than 1 notification per event per user

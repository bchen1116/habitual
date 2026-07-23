# 02 — Solo Challenges

**Goal:** ship the full solo challenge lifecycle: create → check in daily → see progress. Local reminders are gone (was a native concept); push notifications land in step 6 and only for users who install the PWA.

## What ships

- **Create challenge** flow (multi-step, solo only)
- **Dashboard** shows active solo challenges with today's pending check-in
- **Challenge detail** with today's check-in button + history
- **Check-in flow** with optional note (bottom sheet on mobile, modal on desktop)
- **Firestore offline persistence** enabled — check-ins queue and sync when the network returns
- **Optimistic UI** — check-in button flips to "Checked in ✓" instantly and reverts on write failure

## Data model

**`challenges/{challengeId}`** (new)
```
name: string
description: string | null
createdBy: uid
mode: "solo"                     # only solo in this step
forfeitType: "charity"           # only charity in this step
charityName: string
frequency: {
  type: "daily" | "weekly_count"
  target: int                    # for weekly_count
}
skipDays: int
stakeAmount: number
startDate: timestamp
endDate: timestamp
status: "active"
memberIds: [uid]                 # just [creatorUid] for solo
createdAt: timestamp
```

**`challenges/{cid}/members/{uid}`** (subcollection, new)
```
displayName: string              # snapshot at join
joinedAt: timestamp
charityName: string              # solo: same as challenge's
outcome: null                    # set at adjudication (step 3)
completedCount: 0
skipsUsed: 0
```

**`challenges/{cid}/checkins/{yyyymmdd_uid}`** (subcollection, new)

Doc ID enforces one check-in per user per day.
```
uid: string
localDate: "YYYY-MM-DD"          # computed from user.timezone
completedAt: timestamp
note: string | null
```

## Frequency + skip-days semantics

Clarifying because these matter for adjudication in step 3:

- **`daily`:** one check-in required per day. `skipDays` = number of missed days allowed across the whole challenge.
- **`weekly_count`:** `target` check-ins required per rolling 7-day window from `startDate`. `skipDays` = total missed check-ins allowed across the whole challenge (not missed weeks).

Rolling 7-day windows are used to avoid timezone-sensitive week boundaries (Sun–Sat vs Mon–Sun etc.).

## Backend

**Firestore rules:**
```
match /challenges/{cid} {
  allow create: if request.auth.uid == request.resource.data.createdBy;
  allow read: if request.auth.uid in resource.data.memberIds;
  allow update: if request.auth.uid == resource.data.createdBy
                && resource.data.status == "active"
                && request.time < resource.data.startDate;

  match /members/{uid} {
    allow read: if request.auth.uid in get(/databases/$(database)/documents/challenges/$(cid)).data.memberIds;
    allow write: if request.auth.uid == uid;   # solo: only self writes own member doc
  }

  match /checkins/{cid} {
    allow read: if request.auth.uid in get(/databases/$(database)/documents/challenges/$(cid)).data.memberIds;
    allow create: if request.auth.uid == request.resource.data.uid;
    allow update, delete: if false;            # check-ins immutable
  }
}
```

**Firestore indexes:**
- `challenges`: `(createdBy, status)`
- `checkins` (collection group): `(challengeId, localDate)`

**No Cloud Functions in this step.**

## Frontend

**Forms:** `react-hook-form` + `zod` schemas for validation.

**Dates:** `date-fns` (lightweight; use user's locale). Use `date-fns-tz` for user-timezone-aware "today" calculations.

**Today's date for check-in:**
```ts
const today = formatInTimeZone(new Date(), user.timezone, 'yyyy-MM-dd')
```
This gives the user's local date consistently regardless of what timezone they're currently in.

**Offline persistence:**
```ts
// firebase/client.ts
import { enableIndexedDbPersistence } from 'firebase/firestore'
enableIndexedDbPersistence(db).catch(err => {
  // failed-precondition = multiple tabs open (OK, use in-memory)
  // unimplemented = browser doesn't support (OK, fall back)
})
```

**Optimistic check-in:**
- Immediately show "Checked in ✓" locally
- Kick off the write
- On success: no visible change (already updated)
- On failure: revert + toast error

## Screens

- **Dashboard** (`/dashboard`) — populated with active challenges, ledger summary
- **Create challenge** (`/challenges/new`) — multi-step form (see `overview.md`)
- **Challenge detail** (`/challenges/[id]`) — solo variant: progress, check-in button, history
- **Check-in confirmation** — bottom sheet (mobile) / modal (desktop) with optional note

## Reminders — where they went

No local reminders. Local notifications require a native runtime or an installed PWA with background alarms — neither is reliable on the web (especially iOS). Reminders come in step 6 as **web push** for users who install the PWA and grant notification permission.

For users who don't install: they just need to open the site. Empty dashboard makes the daily check-in obvious.

## Non-goals

- Group challenges (step 4)
- Adjudication / ledger creation (step 3)
- Photo evidence
- Push notifications (step 6)
- Retroactive check-ins (only day-of, per the timezone-aware `today`)

## Manual test checklist

- [ ] Create a daily solo challenge (7 days, $10, "Red Cross") from mobile browser
- [ ] Challenge appears on dashboard
- [ ] Click challenge → detail with 0/7 progress
- [ ] Click "Check in for today" → count goes to 1/7, button state changes
- [ ] Try to check in again same day → button disabled or shows "Already checked in today"
- [ ] Simulate next day (change device clock or manually update `localDate`) → new check-in allowed
- [ ] Create a `weekly_count` challenge (5x/week, 4 weeks) → history reflects
- [ ] Offline test: go offline, check in → shows Checked in ✓, comes back online → write goes through
- [ ] Optimistic revert: force a permissions failure → button reverts + error toast
- [ ] Desktop: challenge detail renders in a wider layout (sidebar or centered card, per design)
- [ ] Dark mode across all screens

## Acceptance

- Can create a solo challenge end-to-end from any device
- One check-in per user per day, enforced by doc ID
- Offline check-in works; syncs on reconnect
- No local reminders; users open the site to check in
- Everything responsive across mobile / tablet / desktop

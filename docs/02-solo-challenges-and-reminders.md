# 02 — Solo Challenges & Local Reminders

**Goal:** ship the full solo challenge lifecycle for a single user — create → check in daily → see progress — plus optional local reminders so users don't forget to check in. **No adjudication or ledger yet** (that's step 3).

## What ships

- **Create challenge** screen (multi-step, solo only)
- **Home dashboard** shows active solo challenges
- **Challenge detail** with today's check-in button + history
- **Check-in flow** with optional note
- **Local notifications** for daily reminders at a user-set time (per-challenge)

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
  target: int                    # e.g., 5 (for weekly_count)
}
skipDays: int
stakeAmount: number
startDate: timestamp
endDate: timestamp
status: "active"
memberIds: [uid]                 # just [creatorUid] for solo
reminderTime: string | null      # "HH:mm" local time
createdAt: timestamp
```

**`challenges/{cid}/members/{uid}`** (subcollection, new)
```
displayName: string              # denormalized snapshot at join
joinedAt: timestamp
charityName: string              # copy of challenge's for solo
outcome: null                    # set at adjudication (step 3)
completedCount: 0                # updated at adjudication
skipsUsed: 0
```

**`challenges/{cid}/checkins/{yyyymmdd_uid}`** (subcollection, new)

Document ID enforces one check-in per user per day.
```
uid: string
localDate: "YYYY-MM-DD"          # user's local date
completedAt: timestamp           # actual wall-clock
note: string | null
```

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
    allow write: if request.auth.uid == uid;   # for solo, only self
  }

  match /checkins/{cid} {
    allow read: if request.auth.uid in get(/databases/$(database)/documents/challenges/$(cid)).data.memberIds;
    allow create: if request.auth.uid == request.resource.data.uid;
    allow update, delete: if false;   # check-ins are immutable
  }
}
```

**Firestore indexes:**
- `challenges`: `(createdBy, status)`
- `checkins` (collection group): `(challengeId, localDate)`

**No Cloud Functions yet** — adjudication is step 3.

## Flutter dependencies (new)

```yaml
flutter_local_notifications
timezone
```

## Screens

- **Create challenge** — multi-step flow (see `overview.md` for step list, minus mode/forfeit selection since solo/charity is implied here)
- **Home** — populated dashboard with active challenges + "check in for today" quick actions
- **Challenge detail (solo)** — progress card, check-in button, history

## Local reminders

- On challenge create, if `reminderTime` is set, schedule a daily local notification at that time (using `flutter_local_notifications` with a repeating time trigger).
- On challenge delete or end, cancel the notification.
- Reminder text: `"Time to check in for [Challenge name]"` with a tap-to-open action.

**Timezone handling:** store `reminderTime` as a `HH:mm` string in the user's local timezone. Reschedule when a challenge is edited.

## Non-goals

- Group challenges (step 4)
- Adjudication / ledger creation (step 3)
- Photo evidence
- Push notifications via FCM (step 6)
- Retroactive check-ins ("mark yesterday done") — day-of only

## Manual test checklist

- [ ] Create a solo daily challenge, 7 days, $10 stake, charity "Red Cross", reminder at 18:00
- [ ] Challenge appears on home
- [ ] Tap challenge → detail shows 0/7 complete
- [ ] Tap "Check in for today" → count goes to 1/7, button changes state
- [ ] Attempt to check in again same day → blocked (button disabled or shows "Already checked in")
- [ ] Fast-forward device clock to next day → can check in again
- [ ] Reminder notification fires at 18:00 local time
- [ ] Tap notification → app opens to challenge detail
- [ ] Create a weekly count challenge (5x/week for 4 weeks) → history reflects weekly grouping
- [ ] Delete a challenge → reminder is unscheduled
- [ ] Reboot device → reminders still scheduled (persistence)

## Acceptance

- Can create a solo challenge end-to-end
- One check-in per day; cannot double-check-in
- Local reminders fire and persist across reboots
- History shows all past days with correct status (checked / missed / future)
- Works on iOS and Android

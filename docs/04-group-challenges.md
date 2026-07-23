# 04 — Group Challenges

**Goal:** extend the challenge model to support group challenges with charity-forfeit mode. Members join via a shareable code. **Pool mode is step 5.**

## What ships

- Create challenge flow gains a **Mode** step (Solo / Group)
- Group challenges generate a **join code** (e.g., `AB4X9K`)
- **Share code** button (native share sheet)
- **Join by code** screen
- Join flow: preview → confirm stake → pick your own charity → join
- **Challenge detail (group variant):** member list with live progress, join code (before start)
- Adjudication updated to create one ledger entry per failed member (still charity mode only in this step)

## Data model changes

**`challenges/{challengeId}`** (updated)
```
mode: "solo" | "group"
joinCode: string | null           # 6-char alphanumeric, unique across active challenges
maxMembers: int | null            # optional cap (default: no cap)
# memberIds array continues to reflect current membership
```

**Members subcollection:** same as before, but now each user picks their own `charityName` when joining (not inherited from the creator).

## Backend

**Callable Cloud Function `joinChallenge(joinCode, charityName)`:**
- Validate:
  - Code exists, points to an active challenge
  - Challenge has not started (`now < startDate`)
  - Not full (`memberIds.length < maxMembers` if set)
  - User is not already a member
- Atomically:
  - Add uid to `memberIds`
  - Create members subcollection doc with user's chosen `charityName`
- Return the challenge id
- Errors: invalid code, full, started, already joined

**Callable Cloud Function `previewChallenge(joinCode)`:**
- Returns non-sensitive challenge details for the join preview (name, creator name, dates, stake, forfeit type, current member count)
- Does not add the user or expose full member list

**Firestore rules (updated):**
```
match /challenges/{cid} {
  # Reading is restricted to members. Non-members must use the previewChallenge function.
  allow read: if request.auth.uid in resource.data.memberIds;
  # Members subcollection: write via Function only.
  match /members/{uid} {
    allow read: if request.auth.uid in get(/databases/$(database)/documents/challenges/$(cid)).data.memberIds;
    allow write: if false;   # go through joinChallenge function
  }
}
```

**Join code generation:** 6-char base32 (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), collision-check on generation, retry up to 3x. Codes are unique only among active challenges — reusable after adjudication.

**Adjudication updates:** iterate all members (not just one), create per-member ledger entries. Otherwise same logic as step 3.

## Flutter dependencies (new)

```yaml
share_plus            # native share sheet
cloud_functions       # for callable functions
```

## Screens

- **Create challenge** — Mode step added (Solo / Group). Group creates a join code shown on the final Review step + on the challenge detail after create.
- **Join by code** — new route: text field → look up → preview card → confirm stake + charity → join
- **Challenge detail (group)** — new variant. See `overview.md`.

## Non-goals

- Pool mode (step 5)
- Photo evidence
- In-app chat
- Real-time typing indicators
- Removing members mid-challenge (locked once started)

## Manual test checklist

- [ ] Create a group challenge → join code appears on detail screen
- [ ] Tap Share → native share sheet with the code
- [ ] On a second device (different user), enter code in Join by code → preview shows correct challenge
- [ ] Enter own charity name → tap Join → both devices show the new member in realtime
- [ ] Second user cannot re-join same challenge (error)
- [ ] After startDate, join code lookup fails (challenge started)
- [ ] Each member checks in independently over the challenge period
- [ ] After endDate, adjudication runs → ledger entries created per failed member, each to their own chosen charity
- [ ] Challenge detail shows all member outcomes after adjudication
- [ ] Non-member cannot read the challenge doc (Firestore rule)

## Acceptance

- Users can create group challenges and share join codes
- Users can join via code; each picks their own charity
- Group challenge detail shows all members with live progress
- Adjudication produces one correct ledger entry per failed member

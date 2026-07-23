# 04 — Group Challenges

**Goal:** extend challenges to support group mode with charity forfeit. Members join via a **shareable URL** — no deep-link infrastructure needed; a URL is a URL. **Pool mode is step 5.**

## What ships

- Create flow gains a **Mode** step (Solo / Group), with an optional **max members** cap for groups
- **`createChallenge` callable** — challenge creation (solo and group) moves server-side: it creates the challenge doc, the creator's member doc, and a collision-checked join code atomically. It has to be server-side — clients can't collision-check codes because the read rules stop them from querying other users' challenges, and step 2's client-side member-doc write is closed off below.
- Group challenges get a **join code** (e.g., `AB4X9K`) and a URL (`/join/[code]`)
- **Join preview** page — public route (renders even for signed-out visitors with proper OG meta)
- Native **share** on mobile (`navigator.share`) / **Copy link** button on desktop
- **Challenge detail (group variant)** — member list with live progress (Firestore realtime listeners), forfeit badge, join code + share button (only before start)
- Adjudication updated to create one ledger entry per failed member (still charity mode)

## Data model changes

**`challenges/{cid}`** (updated)
```
mode: "solo" | "group"
joinCode: string | null           # 6-char base32, uppercase, active-unique
maxMembers: int | null            # optional cap (default: no cap)
```

**Members subcollection:** users now each pick their own `charityName` when joining (not inherited from creator).

## Join codes

**Alphabet:** `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (30 chars — excludes `I`, `O`, `0`, `1`, and `L` for readability when typed or read aloud)

**Length:** 6 chars → 30^6 ≈ 729M combinations. Collision-check on generation, retry up to 3× if needed.

**Uniqueness:** only unique among **active** (non-adjudicated) challenges. Reusable after a challenge ends.

## URL structure

- `/join/[code]` — public preview page (server-rendered with OG meta for shared link previews)
- Backwards compatibility: also accept the "join by code" input as a modal from dashboard for users who receive a code without a URL

## Backend

> **Implementation note:** the server-side functions below shipped as
> authenticated Next.js route handlers (`/api/challenges`,
> `/api/challenges/join`) rather than callable Cloud Functions — same trust
> level (Admin SDK behind session-cookie verification), one less deploy
> surface, no CORS. The preview lookup runs directly in the `/join/[code]`
> server component via the Admin SDK. The requirement that matters —
> clients cannot write challenges/members directly — is enforced by rules
> either way.

**Callable Cloud Function `createChallenge(payload)`:**
- Validates the payload (whole-week duration for `weekly_count`, stake > 0, endDate after startDate, mode/forfeit consistency)
- Atomically creates the challenge doc, the creator's member doc, and — for group mode — a collision-checked join code
- Returns the challenge id (plus the join code for groups)
- From this step on **all** challenge creation goes through this function; step 2's client-side `allow create` rule is retired. (Without this, closing the members-subcollection write rule below would leave creators unable to create their own member doc.)

**Callable Cloud Function `joinChallenge(joinCode, charityName)`:**
- Validate:
  - Code exists and points to an active challenge
  - Challenge has not started (`now < startDate`)
  - Not full (`memberIds.length < maxMembers` if set)
  - User is not already a member
- Atomically (in a transaction):
  - Add uid to `memberIds`
  - Create members subcollection doc with user's chosen `charityName`
- Returns the challenge id
- Errors: invalid code, full, started, already joined

**Callable Cloud Function `previewChallenge(joinCode)`:**
- Returns non-sensitive challenge details (name, creator name, dates, stake, forfeit type, member count)
- Used by the `/join/[code]` page's server-side render to populate the preview + OG meta
- Doesn't add the user; doesn't expose full member list

**Firestore rules (updated):**
```
match /challenges/{cid} {
  allow read: if request.auth.uid in resource.data.memberIds;
  allow create: if false;    # all creation goes through createChallenge now
  # Term edits (name, dates, stake, forfeit…) only while the creator is the
  # sole member. Once anyone else joins, the only permitted change is
  # cancelling before the start date — members joined under specific terms,
  # and those terms can't shift under them. (dateInt = helper from step 2.)
  allow update: if request.auth.uid == resource.data.createdBy
                && resource.data.status == "active"
                && dateInt(request.time) < int(resource.data.startDate)
                && (
                     resource.data.memberIds.size() == 1
                     || (request.resource.data.diff(resource.data).affectedKeys().hasOnly(["status"])
                         && request.resource.data.status == "cancelled")
                   );
  match /members/{uid} {
    allow read: if request.auth.uid in get(/databases/$(database)/documents/challenges/$(cid)).data.memberIds;
    allow write: if false;   # go through createChallenge / joinChallenge functions
  }
}
```

The `previewChallenge` function bypasses the rule since it runs with Admin SDK privileges and returns only non-sensitive fields.

**Adjudication updates:** iterate all members, create per-member ledger entries. Otherwise same logic as step 3.

## Frontend

**Join flow:**
1. User taps shared URL → `/join/[code]` renders with challenge preview (server-rendered, sees OG meta if unfurled)
2. If signed out: **Sign in to join** — after auth, returns to `/join/[code]`
3. If signed in: shows **Join challenge** button
4. Tapping opens a confirm dialog: displays stake + charity input (free text) + Join/Cancel
5. On join: navigate to `/challenges/[id]`

**Sharing:**
- Mobile (supports `navigator.share`): tap Share → native share sheet with URL
- Desktop: **Copy link** button copies `https://habitual.app/join/AB4X9K` to clipboard, shows "Copied ✓" toast for 2s

**OG meta on join preview:**
```html
<meta property="og:title" content="Join the '5x Stretching' challenge" />
<meta property="og:description" content="7 days, $10 stake, hosted by Alice" />
<meta property="og:image" content="/og-images/join-generic.png" />
```
For MVP a single generic OG image is fine. Later, generate per-challenge OG images (via `@vercel/og` or similar).

**Realtime member list:**
```ts
onSnapshot(collection(db, `challenges/${cid}/members`), snap => {
  setMembers(snap.docs.map(...))
})
```
Firestore realtime listener; unsubscribe on unmount.

## Screens

- **Create challenge** — Mode step added (Solo / Group), including an optional **max members** input when Group is selected. Group creates a join code shown on the review step + on the challenge detail after creation.
- **Challenge detail (group)** — join code + Copy/Share (before start), member list with live progress, forfeit badge
- **Join preview** (`/join/[code]`) — public, server-rendered with OG meta

## Non-goals

- Pool mode (step 5)
- In-app chat
- Removing members mid-challenge (locked once started)
- Per-challenge OG image generation (later polish)

## Manual test checklist

- [ ] Create a group challenge → join code appears; challenge detail shows code + Share/Copy button
- [ ] Copy link on desktop → paste elsewhere → URL is `https://<host>/join/[code]`
- [ ] Send URL to another device via Messages → link preview shows challenge name + OG image
- [ ] Open URL on the second device (signed out) → sees preview, prompted to sign in
- [ ] Sign in → returns to `/join/[code]` → sees Join button
- [ ] Confirm with own charity name → member appears on both devices in realtime
- [ ] Cannot re-join same challenge (error)
- [ ] After startDate, join code lookup fails with "challenge has started"
- [ ] Each member checks in independently over the challenge period
- [ ] Adjudication creates one ledger entry per failed member, each to their own charity
- [ ] Non-member cannot read the challenge doc (Firestore rule)

## Acceptance

- Users can create and join group challenges via URL or code
- Shared URLs render with proper preview (title, description, OG image) in Messages/WhatsApp/Slack/etc.
- Group detail shows all members with live progress
- Adjudication produces correct per-member ledger entries

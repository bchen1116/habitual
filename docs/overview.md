# Habitual — Product Overview

**For:** designers and anyone new to the project.
**What it is:** a habit tracker that puts money at stake, but never actually moves the money. Users owe (a charity or a friend) when they fail; Habitual keeps score and lets people mark debts settled after paying off-app.

---

## The pitch

Habit trackers don't work because nothing is at stake. Habitual makes commitments real by turning "I'll try" into a signed debt with your friends watching — and a receipt at the end if you drop the ball.

Think **Splitwise for accountability**. The app is a ledger, not a wallet.

## Why the model works

- **Solo mode:** promise yourself $10 → fail → you owe $10 to a charity you named.
- **Group mode:** everyone in the group stakes → fail → you owe your stake to either:
  - your chosen charity (**charity forfeit**), or
  - the group members who succeeded (**winner pool**).
- **The app never touches money.** Users settle among themselves via Venmo, cash, Zelle — whatever they use already. Habitual just tells them what they owe and lets them mark debts settled (optionally with a receipt as proof).

This sidesteps escrow, KYC, payment processing, App Store IAP restrictions, and gambling law questions. All while keeping the psychological weight of real stakes, because your friends can see what you owe until you pay it.

## Personas

- **Solo self-improver.** Uses solo mode. Picks a charity they dislike so failure hurts.
- **Friend group.** 3–5 people running a monthly challenge together. Often pool mode for competitive edge.
- **Couple.** Two people, shared or parallel habits. Usually charity mode with mutual visibility.

## Core user flows

1. **Onboarding:** Splash → Sign in (Google/Apple) → Empty home → "+" → Create challenge.
2. **Daily loop:** Open app → home shows today's pending check-ins → tap to check in.
3. **End of challenge:** Push notification → tap → challenge detail shows outcomes → if you owe, tap ledger entry, pay off-app, mark settled.
4. **Join a group:** Friend shares a code → open app → tap "Join by code" → enter code → confirm stake + pick your charity (if applicable) → done.
5. **Manage debts:** Home → ledger summary → tap → tabs (I owe / I'm owed) → tap entry → mark settled, optionally upload receipt.

---

## Screen inventory

| Group | Screen | Purpose |
|---|---|---|
| Auth | Splash | Route logged-in users past sign-in |
| Auth | Sign in | Google + Apple |
| Home | Dashboard | Active challenges, today's check-ins, ledger summary |
| Challenge | Create challenge (flow) | Multi-step form to define a new challenge |
| Challenge | Detail (solo) | View, progress, check-in, adjudication result |
| Challenge | Detail (group) | Same as solo + member list, join code, forfeit type |
| Challenge | Check-in confirm | Mark today done, optional note |
| Challenge | Join by code | Enter code → preview → confirm stake + charity |
| Ledger | Overview | Two tabs (I owe / I'm owed), filter, grouped by counterparty |
| Ledger | Entry detail | See a single debt, mark settled, upload receipt |
| Ledger | Settle sheet | Confirm payment + optional proof |
| Settings | Profile | Name, avatar, sign out, delete account |
| Settings | Notifications | Per-category toggles |

Plus system states: empty states, loading skeletons, error snackbars.

---

## Screen details

### Splash / launch

**Purpose:** briefly branded splash while auth state resolves.
**Elements:** logo, subtle loading indicator.
**States:** always loading (short-lived).
**Navigates to:** Sign in (if signed out) or Home (if signed in).

### Sign in

**Purpose:** onboard a new user or return a signed-out user to auth.
**Elements:**
- App logo + name (Habitual)
- Tagline: "Put your money where your habits are."
- **Continue with Google** button
- **Continue with Apple** button (iOS always; Android if enabled)
- Terms of Service and Privacy Policy links (small, at bottom)

**States:**
- Idle
- Signing in (buttons disabled, spinner over the tapped one)
- Error (snackbar with human-readable message; buttons re-enabled)

**Design notes:**
- No email/password option in v1 — social only.
- Apple sign-in is required on iOS to comply with App Store guidelines if any social login is offered.

### Home / Dashboard

**Purpose:** central hub. First thing users see when signed in.

**Elements:**
- Top bar: avatar (tap → profile), app title or logo
- **Ledger summary card** at top:
  - "You owe **$47** across 3 debts" (tap → ledger, defaults to "I owe" tab)
  - "You're owed **$12**" (if any)
  - "You're all settled" (if nothing outstanding)
- **Active challenges** section:
  - Each row: challenge name, mode badge (Solo/Group), small progress bar, days remaining
  - Prominent "Check in for today" button if today's check-in is still pending
  - Row tap → challenge detail
- **Bottom actions** (or FAB):
  - **+ Create challenge** (primary)
  - **Join by code** (secondary)

**States:**
- Empty (no challenges): friendly copy — "No active challenges yet. Start one to hold yourself to it."
- Loading: skeleton cards for challenges + ledger summary
- Populated

**Behavior:**
- Pull to refresh
- Realtime updates when a group member checks in

### Create challenge (multi-step)

**Purpose:** define a new challenge. Multi-step so no single screen is overwhelming.

**Steps** (each can be a page or bottom sheet — designer's call):

1. **Basics** — name (required, e.g. "Stretch 5x a week"), description (optional)
2. **Mode** — Solo / Group toggle
3. **Frequency** — Daily / N times per week (with target input if the latter)
4. **Duration** — start date, end date (or duration picker: 1 week / 2 weeks / month / custom)
5. **Skip days** — how many misses allowed (0+)
6. **Stake** — dollar amount (numeric input, USD)
7. **Forfeit type** (only if Group) — Charity forfeit / Winner pool
8. **Charity name** (only if Charity mode) — free text input
9. **Reminder time** — optional daily reminder time picker
10. **Review** — summary of all fields, "Create challenge" button

**States:**
- Each step: Next disabled until valid
- On create (submit): loading spinner
- On success: navigate to challenge detail. If group, prominent join code display + "Share" action.
- On error: inline error at step or snackbar

**Notes:**
- Group creation shows a shareable join code (e.g., `AB4X9K`) after creation.
- Solo creation is active immediately.

### Challenge detail (solo)

**Purpose:** view one solo challenge; check in; see progress and outcome.

**Elements:**
- Header: challenge name, mode badge (Solo), status pill (Active / Ended / Adjudicated)
- **Progress card:** X of Y check-ins complete, current streak, days remaining
- **Skip days used:** "2 of 3 skips used" (subdued if 0)
- **Today's check-in:** big button "Check in for today" if pending; "Checked in ✓" if done today
- **History:** list of past days with status (✓ checked in, ⊘ missed / used a skip, — future)
- **Forfeit info:** subtle footer — "If you fail, you owe $10 to Red Cross"
- **Overflow menu:** cancel challenge (creator only, only before start)

**States:**
- Not started (before startDate): show countdown "Starts in 2 days"
- Active
- Ended, awaiting adjudication: "Results tomorrow morning"
- Adjudicated — succeeded: green banner "You did it! 🎉"
- Adjudicated — failed: red-ish banner "You missed too many days. You owe $10 to Red Cross." — button linking to the ledger entry

### Challenge detail (group)

**Purpose:** same as solo plus member visibility and forfeit-type context.

**Elements** (in addition to solo elements):
- **Forfeit type badge:** "Charity forfeit" or "Winner pool"
- **Join code + Share button** (only visible before startDate; hides once challenge starts)
- **Members section:** list of members with avatar, name, small progress bar (X/Y)
  - Live-updates as members check in (Firestore realtime)
- **Group summary:** "3 of 5 on track" at top of member list
- **Your row** highlighted (you're one of the members)

**Adjudicated states:**
- Winners and losers visually distinguished (green check, red mark)
- If pool mode: show per-member outcome — "You get $10" or "You owe $5 each to Alice, Bob"

### Check-in confirm

**Purpose:** mark today's habit as done.

**Elements** (bottom sheet from challenge detail):
- Challenge name at top
- Prominent "Check in" button
- Optional note field (single line, placeholder "Add a note (optional)")
- Cancel action

**States:**
- Idle
- Submitting (button disabled, spinner)
- Success (checkmark animation, auto-dismiss)

**Alternative:** could be inline on challenge detail (tap → done, no sheet). Designer's call — the sheet is only worth it if we want the note field.

### Join by code

**Purpose:** join a group challenge shared by a friend.

**Elements:**
- Text field for join code (auto-uppercase, format-hint like `AB4X9K`)
- **Look up** button
- After lookup: preview card showing challenge name, creator, dates, stake, forfeit type, current members
- **Join challenge** button
- Confirm sheet: displays stake amount, charity name input (if charity mode), Cancel/Join

**States:**
- Empty field
- Looking up (spinner)
- Preview shown
- Confirming (modal)
- Joined → navigate to challenge detail
- Errors: invalid code, challenge full, challenge started, already a member

### Ledger overview

**Purpose:** see all money owed / owed to me. Manage debts.

**Elements:**
- Tabs: **I owe** (default) | **I'm owed**
- Filter chips: All / Unsettled / Settled
- Total banner at top of each tab: "**$47** unsettled"
- Grouped list by counterparty:
  - Group header: counterparty avatar + name + subtotal ("Red Cross — $30")
  - Rows under header: individual challenges → amount → status pill
  - Row tap → entry detail
- Optional: swipe left on a row → "Mark settled" quick action

**States:**
- Empty (I owe): "You're all settled 🎉" or "No debts yet — nice."
- Empty (I'm owed): "No one owes you right now."
- Loading: skeleton
- Populated

### Ledger entry detail

**Purpose:** see one debt or credit. Take action.

**Elements:**
- Header: amount + counterparty ("$10 to Red Cross" or "$5 from Alice")
- Source challenge (link → challenge detail)
- Created date, adjudication date
- Status pill: Unsettled / Settled
- If unsettled and I owe: **Mark as settled** button
- If settled: settled date + receipt thumbnail (if uploaded)
- Optional note field (shown if present)

### Settle sheet

**Purpose:** confirm the debt is paid; optionally attach proof.

**Elements** (modal from ledger entry detail):
- "Confirm you've paid **$10** to **Red Cross**"
- Optional receipt upload (photo picker with camera or library)
- Optional note field
- **Mark settled** button
- Cancel

**States:**
- Idle
- Uploading receipt (progress bar)
- Submitting (spinner)
- Done → back to entry detail, now Settled

### Profile

**Purpose:** account settings.

**Elements:**
- Avatar + display name (tap to edit)
- Email (read-only)
- Notification settings (link → notification screen)
- About: version, terms, privacy policy
- Sign out
- **Delete account** (danger action at bottom, requires confirmation)

### Notification settings

**Purpose:** configure what pushes the user gets. Local reminders (per-challenge) also managed here globally.

**Elements:**
- Section: **Check-in reminders** — global default time picker + per-challenge overrides
- Section: **Group activity** — toggle (someone joined, someone checked in)
- Section: **Challenge lifecycle** — toggle (starting, ending soon, results in)
- Section: **Ledger** — toggle (new debt, someone settled)
- If system permissions denied: "Notifications are off in system settings." + link

---

## Interactions and gestures

- **Pull to refresh** on lists (home, ledger)
- **Swipe left** on a ledger row → quick Mark Settled
- **Tap avatar** in top bar → profile
- **Long press** on a challenge row → context menu (share, delete if applicable)
- **Bottom sheet** for check-in confirmation and settlement
- **Native share sheet** for join codes

## Empty and error states

Every list screen needs an intentional empty state. Errors surface as inline messages (for form validation) or snackbars (for network/async). Loading uses skeleton loaders on primary content and spinners for buttons.

## Design considerations

**Feel:** warm, human, supportive. Habitual is the friend who keeps track without being preachy.

**Not:** corporate finance app, punitive tracker, gambling app, gamified point-farm.

**Reference apps:** Splitwise (ledger feel), Streaks (habit UI), Duolingo (streak nudging without harassment).

**Platforms:** Flutter Material 3 with adaptive widgets. Follow platform conventions (iOS-style modals on iOS, Material transitions on Android).

**Dark mode:** fully supported.

**Accessibility:** dynamic type, sufficient contrast (WCAG AA), VoiceOver / TalkBack labels on all interactive elements, no color-only meaning.

## Brand direction (TBD by designer)

- **Name:** Habitual
- **Tagline:** "Put your money where your habits are" (suggestion — refine as needed)
- **Palette:** designer's call. Suggestion: warm neutral, not fintech blue.
- **Icon:** designer's call. Suggestion: something that reads as commitment + tracking (checkmark motif, calendar, streak dots).
- **Typography:** system stack fine for v1 (SF / Roboto).

---

## What's out of v1

- Photo evidence for check-ins (log-based only in v1)
- Multiple currencies (USD only)
- Actually processing payments (users settle off-app)
- Real-time chat within groups
- Recurring / auto-restart challenges
- Habit types beyond daily / weekly count
- Analytics dashboards for the user's own history
- Charity search / API integration (free-text only in v1)

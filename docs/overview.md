# Habitual — Product Overview

**For:** designers and anyone new to the project.
**What it is:** a habit tracker that puts money at stake, but never actually moves the money. Users owe (a charity or a friend) when they fail; Habitual keeps score and lets people mark debts settled after paying off-app.

**Platform:** mobile-first responsive **web app**. Works on any modern browser (mobile, tablet, desktop). Installable as a PWA for a native-feel experience — and to unlock push notifications on iOS.

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

This sidesteps escrow, KYC, payment processing, and gambling-law questions while keeping the psychological weight of real stakes — because your friends can see what you owe until you pay it.

## Why web (not native)

- **No app stores.** No review process, no TestFlight, no privacy manifest.
- **Cross-platform for free.** Same codebase for mobile browsers, desktop browsers, and PWA install.
- **Shareable URLs.** Group join links are literal URLs — no deep-link infrastructure.
- **Instant deploys.** Push to `main` → live in seconds.
- **Trade-off:** notifications are weaker (see Notifications below).

## Personas

- **Solo self-improver.** Uses solo mode. Picks a charity they dislike so failure hurts.
- **Friend group.** 3–5 people running a monthly challenge together. Often pool mode for competitive edge.
- **Couple.** Two people, shared or parallel habits. Usually charity mode with mutual visibility.

## Core user flows

1. **Onboarding:** Landing page → Sign in (Google/Apple) → Empty home → "+" → Create challenge.
2. **Daily loop:** Open the site → home shows today's pending check-ins → tap to check in.
3. **End of challenge:** Notification (if enabled) or user opens the site → challenge detail shows outcomes → if you owe, tap ledger entry, pay off-app, mark settled.
4. **Join a group:** Friend shares a link (`habitual.app/join/AB4X9K`) → open on any device → see challenge preview → sign in if needed → confirm stake + pick charity (if applicable) → done.
5. **Manage debts:** Home → ledger summary → tap → tabs (I owe / I'm owed) → tap entry → mark settled, optionally upload receipt.
6. **Install to home screen:** After a few visits (or on the notification permission ask), we prompt the user to install Habitual as a PWA. On iOS this is required for push notifications.

---

## Notifications (important context)

Web notifications are less powerful than native. The plan:

- **Chrome, Firefox, Edge (desktop + Android):** web push works after user grants permission. Full support.
- **Safari on iOS:** web push **only** works if the user installs the site as a PWA (iOS 16.4+). Non-installed users get no push.
- **Safari on macOS:** web push works if the user "allows notifications" in Safari (no install required).

**Strategy:** encourage PWA install to unlock push everywhere. Users who don't install just need to open the site — everything still works, they just won't get pinged.

**No email or SMS fallback** in v1 (per spec). If a user isn't reachable via push, they see updates when they visit.

---

## Screen inventory

| Group | Screen (route) | Purpose |
|---|---|---|
| Public | Landing (`/`) | Marketing + sign-in for signed-out users |
| Public | Join preview (`/join/[code]`) | Renders even for signed-out users so shared links show a preview with OG meta |
| Auth | Sign in (`/login`) | Google + Apple |
| Home | Dashboard (`/dashboard`) | Active challenges, today's check-ins, ledger summary |
| Challenge | Create (`/challenges/new`) | Multi-step form |
| Challenge | Detail (`/challenges/[id]`) | Progress, check-in, adjudication result; solo vs group variants |
| Ledger | Overview (`/ledger`) | Two tabs (I owe / I'm owed), filter, grouped |
| Ledger | Entry (`/ledger/[entryId]`) | Single debt, mark settled, upload receipt |
| Settings | Profile (`/settings`) | Name, avatar, sign out, delete account |
| Settings | Notifications (`/settings/notifications`) | Install prompt, permission toggle, per-category prefs |
| System | Install prompt | Contextual UI + native `beforeinstallprompt` handling |

Plus: empty states, loading skeletons, error toasts, page transitions.

---

## Screen details

### Landing (`/`)

**Purpose:** first impression for signed-out visitors + auto-redirect for signed-in ones.

**Elements:**
- Logo + name (Habitual)
- Tagline: "Put your money where your habits are."
- Short pitch (2 sentences)
- **Get started** button → `/login`
- Footer: Terms, Privacy, About

**States:**
- Signed out: full landing
- Signed in: redirect to `/dashboard` (server-side to avoid flash)

### Sign in (`/login`)

**Purpose:** authenticate.

**Elements:**
- App name + logo
- **Continue with Google** button
- **Continue with Apple** button
- Terms + Privacy links

**States:**
- Idle
- Signing in (button loading state)
- Error (inline error message)

**Design notes:**
- No email/password in v1
- Auth via Firebase popup (desktop) or redirect (mobile — some browsers block popups)

### Dashboard (`/dashboard`)

**Purpose:** central hub. First screen after sign-in.

**Elements:**
- Top bar: avatar (→ `/settings`), app title, primary "New" button
- **Ledger summary card:**
  - "You owe **$47** across 3 debts" → tap opens `/ledger`
  - "You're owed **$12**"
  - "You're all settled" if nothing outstanding
- **Active challenges** section:
  - Row per challenge: name, mode badge (Solo/Group), progress bar, days remaining
  - Prominent "Check in for today" button when pending
  - Row click → `/challenges/[id]`
- **Actions:**
  - **+ Create challenge** (primary; opens `/challenges/new`)
  - **Join by code** (secondary; opens a small modal to paste a code — since URLs work directly, this is a backup)
- **PWA install banner:** if not installed and dismissible has been shown < N times, prompt at bottom ("Add Habitual to your home screen — get reminders and quick access")

**States:**
- Empty: friendly copy ("No active challenges yet. Start one to hold yourself to it.")
- Loading: skeleton
- Populated

**Behavior:**
- Pull to refresh (mobile) / auto-refresh on focus (desktop)
- Firestore realtime updates on member check-ins

### Create challenge (`/challenges/new`)

**Purpose:** multi-step form.

**Steps** (each a section or step page; designer's call):
1. **Basics** — name (required), description (optional)
2. **Mode** — Solo / Group
3. **Frequency** — Daily / N times per week (with target)
4. **Duration** — start date, end date (or duration presets)
5. **Skip days** — how many misses allowed
6. **Stake** — dollar amount (USD)
7. **Forfeit type** (Group only) — Charity forfeit / Winner pool
8. **Charity name** (Charity mode) — free text
9. **Review** — summary + "Create challenge"

**States:**
- Per step: Next disabled until valid
- On submit: loading, then redirect to challenge detail
- Group create: prominent join code + "Copy link" / "Share" on success

### Challenge detail (`/challenges/[id]`)

**Solo variant:**
- Header: name, mode badge (Solo), status pill
- Progress card: X of Y complete, streak, days remaining
- Skip days used
- **Check in for today** button (or "Checked in ✓")
- History list
- Forfeit info footer ("If you fail, you owe $10 to Red Cross")
- Overflow menu: cancel (creator only, before start)

**Group variant** (adds):
- Forfeit type badge (Charity / Pool)
- Join code + copy/share button (before start only)
- Member list with live progress bars (Firestore realtime)
- Group summary ("3 of 5 on track")

**Adjudicated states:**
- Succeeded: green banner
- Failed: red-ish banner with link to ledger entry
- Group pool mode: per-member outcomes shown ("You owe $5 each to Alice, Bob")

### Check-in confirmation

**Purpose:** mark today done, optional note.

**Presentation:**
- **Mobile:** bottom sheet (drawer)
- **Desktop:** centered modal
- Prominent Check in button, optional note field, cancel

**States:** idle / submitting / success (auto-dismiss with checkmark animation)

**Optimistic UI:** immediately update the button to "Checked in ✓" and revert if the write fails.

### Join preview (`/join/[code]`)

**Purpose:** public URL friends receive. Renders with OG meta so link previews show challenge name + creator. Signed-out users can view; sign-in required to actually join.

**Elements:**
- Challenge summary card: name, creator name/avatar, dates, stake, forfeit type, member count
- If signed out: **Sign in to join** → after auth, returns here
- If signed in: **Join challenge** → confirm sheet (charity input if applicable) → joined

**States:**
- Loading, valid preview, invalid code (404-style), challenge started (locked), already a member

### Ledger overview (`/ledger`)

**Purpose:** see all debts. Manage settlement.

**Elements:**
- Tabs: **I owe** (default) | **I'm owed**
- Filter chips: All / Unsettled / Settled
- Total banner: "**$47** unsettled"
- Grouped list by counterparty (charity name or user)
  - Group header + subtotal
  - Rows: challenge → amount → status pill
  - Row click → `/ledger/[entryId]`

**Row actions:**
- **Mobile:** swipe left → Mark Settled (with confirm)
- **Desktop:** hover reveals inline "Mark settled" button
- Right-click / long-press: context menu

**States:**
- Empty (I owe): "You're all settled" / "No debts yet — nice."
- Empty (I'm owed): "No one owes you right now."
- Loading, populated

### Ledger entry (`/ledger/[entryId]`)

**Elements:**
- Header: amount + counterparty
- Source challenge (link)
- Created date, adjudication date
- Status pill
- If unsettled + I owe: **Mark as settled** button
- If settled: settled date + receipt thumbnail (if uploaded)
- Optional note

### Settle sheet

**Purpose:** confirm payment, optionally attach receipt.

**Presentation:**
- Mobile: bottom sheet
- Desktop: modal

**Elements:**
- "Confirm you've paid **$10** to **Red Cross**"
- Optional file input for receipt (drag-and-drop on desktop; tap → camera or photo library on mobile)
- Optional note
- **Mark settled** button
- Cancel

### Settings — Profile (`/settings`)

- Avatar + display name (editable inline)
- Email (read-only)
- Notifications → `/settings/notifications`
- About: version, terms, privacy
- **Sign out**
- **Delete account** (danger; requires typing "delete" to confirm)

### Settings — Notifications (`/settings/notifications`)

- **PWA install status:** if not installed, show install button/instructions
- **Push permission status:** if not granted, prompt with explanation + request button
- Per-category toggles:
  - Group activity (someone joined, someone checked in)
  - Challenge lifecycle (starting, ending soon, results in)
  - Ledger (new debt, someone settled)
- If push is unsupported (e.g., iOS Safari without install): show explanation + install instructions

---

## Interactions and gestures

- **Pull to refresh** on mobile lists; auto-refresh on window focus for desktop
- **Swipe left** on ledger row (mobile) / **hover reveal actions** (desktop)
- **Right-click** on desktop / **long-press** on mobile → context menu (share, delete)
- **Bottom sheet** on mobile / **modal dialog** on desktop for the same flows (check-in, settle)
- **Native share** (`navigator.share`) on mobile / **Copy link** on desktop
- **Keyboard shortcuts** on desktop (nice-to-have): `n` = new challenge, `l` = ledger, `/` = search

## Empty and error states

Every list has an intentional empty state (not a blank screen). Errors surface as inline validation (forms) or toasts (async). Loading uses skeleton loaders on primary content and inline spinners for buttons.

## Offline behavior

- **Service worker** caches the app shell (HTML/JS/CSS) — the site loads even offline
- **Firestore offline persistence** enabled — reads use cache, writes queue and sync on reconnect
- **Offline banner** appears when navigator reports offline; disappears on reconnect
- Users can check in offline; it syncs when the network comes back

## Design considerations

**Feel:** warm, human, supportive. Habitual is the friend who keeps track without being preachy.

**Not:** corporate finance app, punitive tracker, gambling app, gamified point-farm.

**Reference apps/sites:** Splitwise (ledger feel), Linear (crisp web polish), Vercel (motion), Cash App (tight mobile UX).

**Responsive breakpoints (suggestion):**
- Mobile: < 640px (single column, bottom sheets)
- Tablet: 640–1024px (single column with wider spacing)
- Desktop: 1024px+ (two-column: sidebar nav + content; modals instead of sheets)

**Touch targets:** ≥ 44×44px on mobile.
**Keyboard navigation:** full tab order on desktop; visible focus rings.
**Motion:** subtle spring animations for page transitions and modals (Framer Motion). Respect `prefers-reduced-motion`.
**Dark mode:** fully supported (system preference, with manual override in settings).
**Accessibility:** WCAG AA contrast, semantic HTML, ARIA where needed, no color-only meaning, dynamic type respected.

## Brand direction (TBD)

- **Name:** Habitual
- **Domain:** TBD (e.g., `habitual.app`, `habitualhabits.com`)
- **Tagline:** "Put your money where your habits are" (suggestion)
- **Palette:** designer's call. Suggestion: warm neutral, not fintech blue.
- **Icon:** designer's call. Needs favicon (32×32, 512×512), Apple touch icon (180×180), PWA icons (192×192, 512×512, maskable), OG image (1200×630).
- **Typography:** designer's call. Suggestion: Inter or system font stack.

## What's out of v1

- Photo evidence for check-ins (log-based only)
- Multiple currencies (USD only)
- Actual payment processing (users settle off-app)
- Real-time chat within groups
- Recurring / auto-restart challenges
- Habit types beyond daily / weekly count
- Email/SMS notifications
- Localization (English only)
- Native iOS or Android app

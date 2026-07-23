# 01 — Scaffolding & Auth

**Goal:** get a Next.js web app running with Firebase Auth (Google + email/password sign-in) and deployed to Vercel. No features yet.

> **Note:** the original plan called for Google + Apple. Apple Sign-In needs a
> paid Apple Developer account, which isn't set up yet — deferred until
> launch prep. Email/password shipped instead so there's always a working
> second option. Revisit before public launch (docs/07's launch checklist
> already flags this).

## What ships

- Next.js 15 (App Router) + TypeScript project scaffolded
- Tailwind CSS + shadcn/ui installed and configured
- Firebase Web SDK connected (client + Admin for server)
- Google sign-in via Firebase Auth
- Email/password sign-in and sign-up, with a minimal post-signup step to
  collect a display name (the one thing Google gives us for free that
  email/password doesn't)
- User document created in Firestore on first sign-in
- Session cookie handling (server-side auth for RSC/route handlers)
- Basic landing page (public) + dashboard page (authenticated)
- Sign out
- Deployed to Vercel with a preview URL
- Dark mode support (system-preference, no manual override yet)

## Data model

**`users/{uid}`** (new)
```
displayName: string
email: string
photoURL: string | null
timezone: string           # IANA tz (e.g., "America/Los_Angeles")
createdAt: timestamp
```

`timezone` is captured on first sign-in from `Intl.DateTimeFormat().resolvedOptions().timeZone` and used later for day-boundary calculations and (in step 6) push scheduling. On subsequent sign-ins, refresh it **only if the user has no active challenges** — freezing the timezone mid-challenge keeps day boundaries stable (and blocks timezone-hopping shenanigans), while refreshing between challenges keeps things correct for users who move.

## Stack

```
next@15
react@19
typescript
tailwindcss
shadcn/ui (via `npx shadcn@latest init`)
firebase (Web SDK — client)
firebase-admin (server; for RSC auth + Cloud Function shared types)
framer-motion (installed here so we can use it in later steps)
zustand (client state store — optional, use if we outgrow React Context)
react-hook-form + zod (forms, added when we start forms in step 2)
```

State management: **Zustand or React Context** for client-side state. Server components handle data fetching where possible. **No Redux.**

## URL structure

- `/` — landing page (redirects to `/dashboard` if signed in)
- `/login` — sign-in page
- `/dashboard` — main app (auth required)
- `/settings` — profile (auth required)

Everything else comes in later steps.

## Backend

**Firestore rules:**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
  }
}
```

Auth via Firebase Admin SDK for server-side session verification. Next.js middleware validates the session cookie and redirects unauthenticated users away from protected routes.

**No Cloud Functions in this step.** All auth is client-side + Firebase's built-in server SDKs.

## Auth flow

- **Google sign-in:** `signInWithPopup(GoogleAuthProvider)`. On mobile Safari (or wherever popups are blocked), falls back to `signInWithRedirect`, completed via `getRedirectResult` on the next load.
- **Email/password sign-up:** `createUserWithEmailAndPassword`, then a second step collects a display name and calls `updateProfile(user, { displayName })` — email/password gives us no name, unlike Google. Sign-in that lands on an account with no `displayName` yet (e.g. the tab closed mid-signup) is routed through the same name step instead of getting stuck.
- **Email/password sign-in:** `signInWithEmailAndPassword`.
- **Session cookie:** after any client sign-in completes, POST the ID token to `/api/auth/session`. Server verifies with Admin SDK and sets an HTTP-only session cookie.
- **Server components:** read the session cookie in `layout.tsx` / server components; call `admin.auth().verifySessionCookie(cookie)` to get uid.
- **Sign out:** client `signOut()` + POST to `/api/auth/session/delete` to clear the cookie.

## What the user does (Firebase console + Vercel — manual)

1. **Firebase project.** Create at [console.firebase.google.com](https://console.firebase.google.com) (name: `habitual` or similar).
2. **Add a Web app** to the project — get the config object (apiKey, authDomain, etc.). Copy it to `.env.local` (I'll list the exact env var names in the PR).
3. **Enable Authentication providers:**
   - **Google** — one click, auto-configured.
   - **Email/Password** — one click, no external account needed.
   - **Apple** — deferred (needs a paid Apple Developer account). When ready: create a Services ID, enable Sign In with Apple, add your domain as a return URL, fill in Firebase's Apple provider config (Team ID, Key ID, private key) — and re-add the button in `/login`.
4. **Enable Firestore** in Native mode (start in production; rules go in the code).
5. **Enable Cloud Storage** (used in step 3).
6. **Upgrade to Blaze** plan (needed for Cloud Functions in step 3; free-tier limits still apply).
7. **Authorized domains.** In Firebase Auth settings, add your Vercel deploy URL(s) so OAuth redirects are allowed.
8. **Vercel project.** Import the GitHub repo, connect to the project, set the env vars (Firebase config + `FIREBASE_SERVICE_ACCOUNT_KEY` for the Admin SDK), deploy.

None of the above can be automated from within this repo — they're clicks on Firebase and Vercel consoles under your accounts.

## Non-goals

- Any features (challenges, ledger, etc.)
- Custom domain (later, in step 7)
- PWA setup (step 6)
- Push notifications (step 6)
- Analytics (step 7)

## Manual test checklist

- [ ] Google sign-in works on Chrome desktop
- [ ] Google sign-in works on iOS Safari (may use redirect flow)
- [ ] Google sign-in works on Android Chrome
- [ ] Email/password sign-up prompts for a name, then lands on the dashboard
- [ ] Email/password sign-in (existing account) skips straight to the dashboard
- [ ] Signing in to an account with no display name (abandoned signup) is routed back through the name step
- [ ] Sign-up with an already-used email shows a clear error, not a crash
- [ ] User doc created in Firestore on first sign-in
- [ ] `timezone` field populated correctly (e.g., "America/Los_Angeles")
- [ ] Signed-in reload: session cookie persists, no re-auth
- [ ] Sign out clears cookie and returns to landing
- [ ] Middleware blocks unauthenticated access to `/dashboard`
- [ ] Firestore rule: signed-out client cannot read any user doc
- [ ] Deployed Vercel URL works with real auth
- [ ] Dark mode: landing and dashboard render correctly at system dark

## Acceptance

- Users can sign in from any modern browser (mobile + desktop)
- User doc exists in Firestore with correct fields
- Deployed and reachable at a Vercel URL
- Sign in / sign out cycle is smooth (no visible flash, no auth flicker)
- Clean TypeScript build with no errors

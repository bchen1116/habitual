# 01 — Scaffolding & Auth

**Goal:** get a Next.js web app running with Firebase Auth (Google + Apple sign-in) and deployed to Vercel. No features yet.

## What ships

- Next.js 15 (App Router) + TypeScript project scaffolded
- Tailwind CSS + shadcn/ui installed and configured
- Firebase Web SDK connected (client + Admin for server)
- Google + Apple sign-in via Firebase Auth
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

`timezone` is captured on first sign-in from `Intl.DateTimeFormat().resolvedOptions().timeZone` and used later for day-boundary calculations and (in step 6) push scheduling.

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

- **Client sign-in:** `signInWithPopup(GoogleAuthProvider)` or `signInWithPopup(OAuthProvider('apple.com'))`. On mobile Safari, fallback to `signInWithRedirect`.
- **Session cookie:** after client sign-in, POST the ID token to `/api/auth/session`. Server verifies with Admin SDK and sets an HTTP-only session cookie.
- **Server components:** read the session cookie in `layout.tsx` / server components; call `admin.auth().verifySessionCookie(cookie)` to get uid.
- **Sign out:** client `signOut()` + POST to `/api/auth/session/delete` to clear the cookie.

## What the user does (Firebase console + Apple + Vercel — manual)

1. **Firebase project.** Create at [console.firebase.google.com](https://console.firebase.google.com) (name: `habitual` or similar).
2. **Add a Web app** to the project — get the config object (apiKey, authDomain, etc.). Copy it to `.env.local` (I'll list the exact env var names in the PR).
3. **Enable Authentication providers:**
   - **Google** — one click, auto-configured.
   - **Apple** — needs an Apple Developer account. Create a Services ID (`com.bchen1116.habitual.web`), enable Sign In with Apple, add your Vercel domain as a return URL. Fill in Firebase's Apple provider config (Team ID, Key ID, private key).
4. **Enable Firestore** in Native mode (start in production; rules go in the code).
5. **Enable Cloud Storage** (used in step 3).
6. **Upgrade to Blaze** plan (needed for Cloud Functions in step 3; free-tier limits still apply).
7. **Authorized domains.** In Firebase Auth settings, add your Vercel deploy URL(s) so OAuth redirects are allowed.
8. **Vercel project.** Import the GitHub repo, connect to the project, set the env vars (Firebase config + `FIREBASE_SERVICE_ACCOUNT_KEY` for the Admin SDK), deploy.

None of the above can be automated from within this repo — they're clicks on Firebase, Apple, and Vercel consoles under your accounts.

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
- [ ] Apple sign-in works on desktop and iOS Safari
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

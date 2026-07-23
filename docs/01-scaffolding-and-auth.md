# 01 — Scaffolding & Auth

**Goal:** get a Flutter app running with Firebase auth (Google + Apple sign-in). No features yet — just a signed-in user landing on an empty home screen.

## What ships

- Flutter project scaffolded (`habitual/`)
- Firebase project connected on both iOS and Android
- Google + Apple sign-in flows
- User document auto-created in Firestore on first sign-in
- Basic home screen: "Hello, [name]" and a sign-out button
- Basic app theming (light + dark)

## Data model

**`users/{uid}`** (new)
```
displayName: string
email: string
photoURL: string | null
createdAt: timestamp
```

## Backend

**Firestore rules:**
```
match /users/{uid} {
  allow read, write: if request.auth.uid == uid;
}
```

**No Cloud Functions yet.** Firestore only.

## Flutter dependencies

```yaml
firebase_core
firebase_auth
cloud_firestore
google_sign_in
sign_in_with_apple
```

State management: **Riverpod** (recommended) or Provider. Pick and stick.

## Screens

- Splash (auth-state resolver, shows briefly)
- Sign in (Google + Apple buttons)
- Home (empty state: "Hello, [name]. No challenges yet.") + sign out button

## What the user does (Firebase console, manual)

This step is mostly clicking around in the Firebase console. Do these before I scaffold the Flutter side:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com). Suggest `habitual-app` or similar.
2. Add an iOS app: bundle ID `com.bchen1116.habitual` (or your preferred). Download `GoogleService-Info.plist`.
3. Add an Android app: package name `com.bchen1116.habitual`. Download `google-services.json`.
4. Enable **Authentication** providers:
   - **Google** — auto-configured (uses the project's OAuth client)
   - **Apple** — requires an Apple Developer Team ID + Sign in with Apple Service ID (configured in developer.apple.com)
5. Enable **Cloud Firestore** in Native mode. Start in production mode (deny-by-default). We'll add rules in the code.
6. Upgrade the project to **Blaze** (pay-as-you-go). Required for Cloud Functions later; free tier still applies until you exceed generous quotas.
7. In Google Cloud Console (linked from Firebase), configure the **OAuth consent screen** for Google sign-in (external, in-testing is fine initially).
8. iOS: in Xcode, enable **Sign in with Apple** capability on the app target. Add the same to your Apple Developer app ID.

Once done, drop the two config files where the PR tells you. I can't do any of the above steps for you — they require your Google/Apple accounts.

## Non-goals

- Any actual habit/challenge functionality
- Email/password auth
- FCM push notifications
- Deep links
- Analytics

## Manual test checklist

- [ ] Cold install on iOS simulator: Google sign-in works, user doc appears in Firestore
- [ ] Cold install on iOS simulator: Apple sign-in works
- [ ] Cold install on Android emulator: Google sign-in works
- [ ] Sign out returns to sign-in screen
- [ ] Kill and reopen: still signed in, goes straight to home
- [ ] Dark mode: both auth and home render correctly
- [ ] Firestore rules: signed-out client cannot read any user doc

## Acceptance

- Users can sign in on both platforms
- User doc exists in Firestore with correct fields
- Home is intentionally empty (feature-free)
- Sign out works
- Clean build, no warnings

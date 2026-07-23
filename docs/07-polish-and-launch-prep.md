# 07 — Polish & Launch Prep

**Goal:** empty states, error handling, loading polish, settings, and everything needed to distribute to TestFlight and Play Store internal testing.

## What ships

- **Empty states** for all list screens (home, ledger, member lists, filters)
- **Loading skeletons** replacing raw spinners on primary content
- **Error boundaries and messaging** for network failures, auth failures, Cloud Function errors
- **Snackbar / toast pattern** for transient feedback (success, info, error)
- **Confirmation dialogs** for destructive actions (cancel challenge, mark settled, sign out, delete account)
- **Profile screen** (edit name, avatar picker)
- **Settings screen:** notifications, about (version, terms, privacy), delete account
- **App icon** (iOS + Android adaptive icon)
- **Splash screen** (both platforms)
- **iOS privacy manifest** (required for App Store as of 2024)
- **Android adaptive icon + notification icon**
- Optional but recommended: separate **dev / prod Firebase projects** and environment configs

## Data model changes

**`users/{uid}`** (updated)
```
deletedAt: timestamp | null      # soft-delete marker
```

## Backend

**Cloud Function: `deleteAccount`** (callable)
- Verify calling user's uid matches target
- Cascade delete:
  - Cancel any active solo challenges (or mark abandoned)
  - Remove user from any active group challenges (if allowed) OR mark user as departed
  - Delete all user's check-ins
  - Anonymize ledger entries: replace `fromName`/`toName` with "Deleted user" but keep amounts (other users may still owe / be owed)
  - Delete receipts from Storage
  - Delete user doc
- Mark user's Firebase Auth account as disabled
- **Note:** since ledger integrity matters for other users, we don't hard-delete debts. The user's identity is scrubbed; the debt remains.

**Firestore: scheduled backup** (optional, recommended before launch)
- Configure daily export to Cloud Storage bucket

## Flutter dependencies (new)

```yaml
flutter_launcher_icons
flutter_native_splash
```

Dev-only:
```yaml
flutter_lints          # already default, but enforce
```

## Screens polish

- **Every list screen** — designed empty state (not a bare "no items")
- **Every button that triggers async** — pressed state + loading spinner in-place
- **Every form** — validation errors inline, not just on submit
- **Network offline** — persistent banner ("You're offline — some things won't work") + retry
- **Auth error** — clear message, don't just fail silently
- **Firestore permission denied** — surface as "Something went wrong. Try again." (never expose raw Firestore errors)

## Settings screen

- Profile section: avatar (tap to change), display name (tap to edit), email (read-only)
- Notifications → routes to Notification Settings (from step 6)
- About: app version, build number, Terms of Service link, Privacy Policy link
- **Sign out** button
- **Delete account** at bottom (danger styling; requires typed confirmation "delete my account")

## Store readiness

**iOS:**
- Privacy manifest (`PrivacyInfo.xcprivacy`) declaring data collected (email, name, device tokens) and required-reason API usage
- App Store Connect record: screenshots, description, keywords, support URL
- TestFlight internal testing setup

**Android:**
- Adaptive icon (foreground + background layers)
- Notification icon (monochrome)
- Play Console record: internal testing track, data safety declaration

**Legal:**
- Terms of Service — must clearly disclaim: no money is processed; users transact off-app; Habitual is not responsible for settling debts
- Privacy Policy — data collected, retention, deletion process, third-party services (Firebase, Google, Apple)

Both can be simple markdown pages hosted anywhere (GitHub Pages, Notion public page, static site). No lawyer needed for v1 — use a template and adapt.

## Non-goals

- Analytics (add separately once we know what to measure)
- Crashlytics (add separately; it's a 15-min integration)
- A/B testing framework
- Marketing site / landing page
- Waitlist / referral flow
- In-app rating prompt
- Localization (English only)

## Manual test checklist

- [ ] Turn off wifi → clear offline banner; no crashes on any screen
- [ ] Turn wifi back on → banner clears, state syncs
- [ ] Sign out and sign back in → account state fully restored
- [ ] Delete account → all personal data purged; ledger entries anonymized; re-signup with same email creates a new account
- [ ] App icon renders correctly on both platforms and in system UI (settings, notifications, home screen)
- [ ] Splash shows briefly on launch (< 2s)
- [ ] All empty states look intentional (not blank screens)
- [ ] Dark mode: every screen readable, no contrast issues
- [ ] Dynamic type (iOS): all text scales without overflow
- [ ] VoiceOver / TalkBack: primary flows work; every button has a label

## Acceptance

- App feels polished on both platforms
- No obvious edge case crashes
- Terms and Privacy Policy in place
- App icon + splash + store metadata ready
- Ready to submit to TestFlight and Play Store internal tracks

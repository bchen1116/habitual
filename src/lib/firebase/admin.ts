import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Lazy singleton: the service-account env var is only parsed when a request
// actually needs the Admin SDK, so builds and public pages don't require it.
let adminApp: App | null = null;

function getAdminApp(): App {
  if (!adminApp) {
    const existing = getApps();
    if (existing.length > 0) {
      adminApp = existing[0];
    } else {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (!raw) {
        throw new Error(
          "FIREBASE_SERVICE_ACCOUNT_KEY is not set. Add it to .env.local (see .env.example)."
        );
      }
      adminApp = initializeApp({ credential: cert(JSON.parse(raw)) });
    }
  }
  return adminApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

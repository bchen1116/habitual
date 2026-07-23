"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

// Lazy singletons so importing this module never touches Firebase during
// prerender/build — config is only read when a browser actually needs it.
let app: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!app) {
    const existing = getApps();
    app =
      existing.length > 0
        ? existing[0]
        : initializeApp({
            apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
            authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
            messagingSenderId:
              process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
          });
  }
  return app;
}

export function getClientApp(): FirebaseApp {
  return getFirebaseApp();
}

export function getClientAuth(): Auth {
  return getAuth(getFirebaseApp());
}

let db: Firestore | null = null;

/**
 * Firestore with offline persistence (IndexedDB, multi-tab). Reads serve
 * from cache when offline; writes queue and sync on reconnect (docs/02).
 * Falls back to the default in-memory instance if IndexedDB is unavailable.
 */
export function getClientDb(): Firestore {
  if (!db) {
    try {
      db = initializeFirestore(getFirebaseApp(), {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      db = getFirestore(getFirebaseApp());
    }
  }
  return db;
}

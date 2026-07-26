"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";

export interface ClientAuthState {
  user: User | null;
  /**
   * False until the SDK's first callback fires. onAuthStateChanged's
   * initial invocation reflects the *resolved* persisted auth state (it
   * doesn't fire early with a false-negative null before rehydrating) —
   * so once `ready` is true, `user === null` means there's genuinely no
   * client-side Firebase session, not a startup race still settling.
   */
  ready: boolean;
}

/**
 * The client Firebase Auth SDK's own session — distinct from, and not
 * necessarily in sync with, the server-side session cookie that gates
 * (app)/layout.tsx. The cookie only proves you were authenticated when it
 * was minted; every direct Firestore read from the browser (onSnapshot,
 * getDocs) is authorized against *this* session instead, so a page can
 * render as "signed in" server-side while every Firestore call fails
 * permission-denied if this session was ever lost (cleared storage,
 * cross-device cookie copy, etc.) without the cookie also expiring.
 */
export function useClientAuthUser(): ClientAuthState {
  const [state, setState] = useState<ClientAuthState>({ user: null, ready: false });

  useEffect(() => {
    return onAuthStateChanged(getClientAuth(), (user) => {
      setState({ user, ready: true });
    });
  }, []);

  return state;
}

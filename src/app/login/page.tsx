"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  OAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  type AuthProvider,
  type User,
} from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";
import { ensureUserDoc } from "@/lib/user";
import { Button } from "@/components/ui/button";

type Provider = "google" | "apple";

function buildProvider(provider: Provider): AuthProvider {
  if (provider === "google") return new GoogleAuthProvider();
  const apple = new OAuthProvider("apple.com");
  apple.addScope("email");
  apple.addScope("name");
  return apple;
}

/** Only allow same-site relative paths as post-login destinations. */
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState<Provider | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completeSignIn = useCallback(
    async (user: User) => {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!response.ok) {
        throw new Error("Failed to establish a session. Please try again.");
      }
      // Best-effort: the session cookie is already set, so a failed profile
      // write must not strand the user here — it re-runs on every sign-in.
      await ensureUserDoc(user).catch((err) =>
        console.error("ensureUserDoc failed:", err)
      );
      router.replace(safeNext(searchParams.get("next")));
    },
    [router, searchParams]
  );

  // Completes the redirect-based flow (mobile browsers that block popups).
  useEffect(() => {
    let cancelled = false;
    getRedirectResult(getClientAuth())
      .then((result) => {
        if (result?.user && !cancelled) {
          setFinishing(true);
          return completeSignIn(result.user);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Sign-in was interrupted. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setFinishing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [completeSignIn]);

  async function signIn(provider: Provider) {
    setError(null);
    setPending(provider);
    const auth = getClientAuth();
    const authProvider = buildProvider(provider);
    try {
      const result = await signInWithPopup(auth, authProvider);
      await completeSignIn(result.user);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        // Fall back to a full-page redirect; the useEffect above completes it.
        await signInWithRedirect(auth, authProvider);
        return;
      }
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setError("Sign-in failed. Please try again.");
      }
      setPending(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Habitual</h1>
        <p className="mt-2 text-muted-foreground">
          Put your money where your habits are.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button
          size="lg"
          variant="outline"
          disabled={pending !== null || finishing}
          onClick={() => signIn("google")}
        >
          {pending === "google" ? "Signing in…" : "Continue with Google"}
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={pending !== null || finishing}
          onClick={() => signIn("apple")}
        >
          {pending === "apple" ? "Signing in…" : "Continue with Apple"}
        </Button>
        {finishing && (
          <p className="text-center text-sm text-muted-foreground">
            Finishing sign-in…
          </p>
        )}
        {error && (
          <p className="text-center text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

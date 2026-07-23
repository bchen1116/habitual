"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
  type User,
} from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";
import { ensureUserDoc } from "@/lib/user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "signin" | "signup";
type Step = "credentials" | "name";

/** Only allow same-site relative paths as post-login destinations. */
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
      return "An account already exists with that email. Try signing in instead.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/unauthorized-domain":
      return "This domain isn't authorized for sign-in yet (Firebase Auth → Settings → Authorized domains).";
    case "auth/operation-not-allowed":
      return "This sign-in method isn't enabled yet (Firebase Auth → Sign-in method).";
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      return "Firebase isn't configured correctly — check your .env.local values.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [pending, setPending] = useState<"google" | "email" | null>(null);
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

  // Completes the Google redirect-based flow (mobile browsers that block popups).
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

  async function signInWithGoogle() {
    setError(null);
    setPending("google");
    const auth = getClientAuth();
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      await completeSignIn(result.user);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        // Fall back to a full-page redirect; the useEffect above completes it.
        await signInWithRedirect(auth, provider);
        return;
      }
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        // Logged, not just shown: the user-facing copy is necessarily generic
        // for unmapped codes, but the real code is what actually diagnoses a
        // misconfiguration (unauthorized domain, provider not enabled, etc).
        console.error("Google sign-in failed:", err);
        setError(authErrorMessage(err));
      }
      setPending(null);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending("email");
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(
          getClientAuth(),
          email,
          password
        );
        // Email/password gives us no name — Google gives one for free.
        // Collect the one piece of info we're actually missing.
        setPendingUser(cred.user);
        setStep("name");
      } else {
        const cred = await signInWithEmailAndPassword(
          getClientAuth(),
          email,
          password
        );
        if (!cred.user.displayName) {
          // Recovers an account that never finished the name step (e.g. the
          // tab was closed mid-signup) instead of leaving them stuck.
          setPendingUser(cred.user);
          setStep("name");
        } else {
          await completeSignIn(cred.user);
        }
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function submitName(e: FormEvent) {
    e.preventDefault();
    if (!pendingUser) return;
    setError(null);
    setPending("email");
    try {
      await updateProfile(pendingUser, { displayName: displayName.trim() });
      await completeSignIn(pendingUser);
    } catch {
      setError("Couldn't save your name. Please try again.");
      setPending(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="type-display text-5xl">Habitual</h1>
        <p className="type-overline mt-3 text-xs text-muted-foreground">
          Put your money where your habits are
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4">
        {step === "credentials" && (
          <>
            <Button
              size="lg"
              variant="secondary"
              disabled={pending !== null || finishing}
              onClick={signInWithGoogle}
            >
              {pending === "google" ? "Signing in…" : "Continue with Google"}
            </Button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="type-overline text-[11px] text-muted-foreground">
                Or
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "signin" ? "secondary" : "outline"}
                className="flex-1"
                onClick={() => switchMode("signin")}
              >
                Sign in
              </Button>
              <Button
                type="button"
                variant={mode === "signup" ? "secondary" : "outline"}
                className="flex-1"
                onClick={() => switchMode("signup")}
              >
                Sign up
              </Button>
            </div>

            <form onSubmit={submitCredentials} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={pending !== null}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 6 : undefined}
                  required
                  disabled={pending !== null}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" size="lg" disabled={pending !== null || finishing}>
                {pending === "email"
                  ? mode === "signup"
                    ? "Creating account…"
                    : "Signing in…"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </Button>
            </form>
          </>
        )}

        {step === "name" && (
          <form onSubmit={submitName} className="flex flex-col gap-3">
            <p className="text-center text-sm text-muted-foreground">
              One more thing — what should we call you?
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="displayName">Name</Label>
              <Input
                id="displayName"
                autoFocus
                required
                maxLength={50}
                disabled={pending !== null}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <Button type="submit" size="lg" disabled={pending !== null}>
              {pending === "email" ? "Saving…" : "Continue"}
            </Button>
          </form>
        )}

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

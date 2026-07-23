"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getClientDb } from "@/lib/firebase/client";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Profile {
  displayName: string;
  username: string | null;
  email: string;
  photoURL: string | null;
}

export function ProfileEditor({ uid }: { uid: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const nameInitialized = useRef(false);
  const usernameInitialized = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(getClientDb(), "users", uid), (snap) => {
      const data = snap.data();
      if (!data) return;
      setProfile({
        displayName: data.displayName ?? "",
        username: data.username ?? null,
        email: data.email ?? "",
        photoURL: data.photoURL ?? null,
      });
      if (!nameInitialized.current) {
        setName(data.displayName ?? "");
        nameInitialized.current = true;
      }
      if (!usernameInitialized.current) {
        setUsername(data.username ?? "");
        usernameInitialized.current = true;
      }
    });
    return unsubscribe;
  }, [uid]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === profile?.displayName) return;
    setSavingName(true);
    setMessage(null);
    try {
      await setDoc(
        doc(getClientDb(), "users", uid),
        { displayName: trimmed },
        { merge: true }
      );
      setMessage("Saved. (Existing challenges keep the name you joined with.)");
    } catch {
      setMessage("Couldn't save your name. Try again.");
    } finally {
      setSavingName(false);
    }
  }

  async function saveUsername() {
    const trimmed = username.trim();
    if (!trimmed || trimmed === (profile?.username ?? "")) return;
    setSavingUsername(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Couldn't save that username.");
      }
      setMessage(
        "Saved. (Challenges you're already in keep the username you had at the time.)"
      );
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Couldn't save that username."
      );
    } finally {
      setSavingUsername(false);
    }
  }

  async function uploadAvatar(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      setMessage("Avatars must be images under 2MB.");
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const storageRef = ref(getStorage(), `avatars/${uid}`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);
      await setDoc(
        doc(getClientDb(), "users", uid),
        { photoURL: url },
        { merge: true }
      );
    } catch {
      setMessage("Couldn't upload the avatar. Try again.");
    } finally {
      setUploading(false);
    }
  }

  if (!profile) {
    return <div className="h-24 animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Change avatar"
          className="relative shrink-0 rounded-full"
        >
          <Avatar src={profile.photoURL} name={profile.displayName} size="lg" />
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-xs text-white">
              …
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => uploadAvatar(e.target.files?.[0])}
        />
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="displayName">Display name</Label>
          <div className="flex gap-2">
            <Input
              id="displayName"
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              onClick={saveName}
              disabled={
                savingName || !name.trim() || name.trim() === profile.displayName
              }
            >
              {savingName ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">Username</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">@</span>
          <Input
            id="username"
            value={username}
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]+"
            title="Letters, numbers, and underscores only"
            onChange={(e) => setUsername(e.target.value)}
          />
          <Button
            onClick={saveUsername}
            disabled={
              savingUsername ||
              !username.trim() ||
              username.trim() === (profile.username ?? "")
            }
          >
            {savingUsername ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Shown alongside your name in groups — helps tell apart people with
          the same name. 3-20 characters: letters, numbers, underscores.
        </p>
      </div>

      <p className="text-sm">
        <span className="text-muted-foreground">Email: </span>
        {profile.email || "—"}
      </p>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

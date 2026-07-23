"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getClientDb } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Profile {
  displayName: string;
  email: string;
  photoURL: string | null;
}

export function ProfileEditor({ uid }: { uid: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const nameInitialized = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(getClientDb(), "users", uid), (snap) => {
      const data = snap.data();
      if (!data) return;
      setProfile({
        displayName: data.displayName ?? "",
        email: data.email ?? "",
        photoURL: data.photoURL ?? null,
      });
      if (!nameInitialized.current) {
        setName(data.displayName ?? "");
        nameInitialized.current = true;
      }
    });
    return unsubscribe;
  }, [uid]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === profile?.displayName) return;
    setSaving(true);
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
      setSaving(false);
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
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-secondary"
        >
          {profile.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoURL}
              alt="Your avatar"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xl font-semibold text-secondary-foreground">
              {(profile.displayName || "?").charAt(0).toUpperCase()}
            </span>
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">
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
              disabled={saving || !name.trim() || name.trim() === profile.displayName}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">Email: </span>
        {profile.email || "—"}
      </p>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Native share sheet where available (mobile), clipboard fallback (desktop).
 */
export function ShareLink({ joinCode, name }: { joinCode: string; name: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/join/${joinCode}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join "${name}" on Habitual`,
          url,
        });
        return;
      } catch {
        // fall through to clipboard (user cancelled or share failed)
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — nothing sensible to do
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={share}>
      {copied ? "Copied ✓" : "Share invite link"}
    </Button>
  );
}

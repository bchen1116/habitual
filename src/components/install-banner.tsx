"use client";

import { useEffect, useState } from "react";
import { isIosSafari, isStandalone } from "@/lib/push";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const DISMISS_KEY = "habitual.installBanner.dismissedAt";
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Dismissible install nudge (docs/06). Chromium: captures
 * beforeinstallprompt and triggers the native prompt. iOS Safari: manual
 * Add-to-Home-Screen instructions (no API exists). Hidden when already
 * installed or recently dismissed.
 */
export function InstallBanner() {
  const [visible, setVisible] = useState(false);
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) return;

    if (isIosSafari()) {
      setVisible(true);
      return;
    }
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 text-sm">
        <p>
          <span className="font-medium">Add Habitual to your home screen</span>{" "}
          — quick access, and reminders can reach you.
        </p>
        {showIosHelp && (
          <p className="text-muted-foreground">
            Tap the Share button in Safari, then{" "}
            <span className="font-medium">Add to Home Screen</span>.
          </p>
        )}
        <div className="flex gap-2">
          {installEvent ? (
            <Button
              size="sm"
              onClick={async () => {
                await installEvent.prompt();
                dismiss();
              }}
            >
              Install
            </Button>
          ) : (
            !showIosHelp && (
              <Button size="sm" onClick={() => setShowIosHelp(true)}>
                Show me how
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

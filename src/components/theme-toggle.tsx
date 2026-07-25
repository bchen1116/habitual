"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * Light/Dark/System toggle for the Settings > Appearance card. `theme`
 * (the stored preference, possibly "system") isn't known until after
 * mount — next-themes reads localStorage client-side — so this renders a
 * disabled placeholder first to avoid a server/client mismatch, same
 * "don't guess before hydration" reasoning as everywhere else in the app
 * that reads persisted per-user state.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex gap-2">
      {OPTIONS.map(({ value, label, Icon }) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={mounted && theme === value ? "secondary" : "outline"}
          disabled={!mounted}
          onClick={() => setTheme(value)}
          className={cn(!mounted && "opacity-50")}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Button>
      ))}
    </div>
  );
}

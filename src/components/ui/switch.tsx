"use client";

import type { ReactNode } from "react";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Accessible name. Required — the visible label is `children`, which a screen reader reads as the button's content, but the track itself carries no text. */
  label: string;
  disabled?: boolean;
  /** The visible label, laid out to the left of the track. */
  children?: ReactNode;
  className?: string;
}

/**
 * An on/off control, `role="switch"` rather than a checkbox: it takes effect
 * the moment it's flipped instead of waiting for a submit, which is what the
 * role actually means. Extracted from notification-settings, where this
 * markup started, once a third place needed it.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  children,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={
        "flex items-center justify-between gap-4 text-left disabled:opacity-60 " +
        (className ?? "")
      }
    >
      {children}
      <span
        aria-hidden="true"
        className={
          "relative h-6 w-10 shrink-0 rounded-full transition-colors " +
          (checked ? "bg-foreground" : "bg-secondary")
        }
      >
        <span
          className={
            "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all " +
            (checked ? "left-[1.125rem]" : "left-0.5")
          }
        />
      </span>
    </button>
  );
}

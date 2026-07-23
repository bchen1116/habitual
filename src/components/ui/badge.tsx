import * as React from "react";
import { cn } from "@/lib/utils";

const VARIANT_CLASSES = {
  /** SOLO tag, STREAK-adjacent ink pills. */
  ink: "bg-ink text-primary",
  /** GROUP tag, and other bordered outline pills. */
  outline: "border-[1.5px] border-foreground text-foreground",
  /** The one-volt-element pill (e.g. "STREAK 18"). */
  volt: "bg-primary text-primary-foreground",
  /** Neutral status labels (e.g. challenge state). */
  secondary: "bg-secondary text-secondary-foreground",
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLElement> {
  variant?: keyof typeof VARIANT_CLASSES;
}

export function Badge({ variant = "ink", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "type-overline inline-flex items-center rounded-full px-2.5 py-1 text-[11px]",
        VARIANT_CLASSES[variant],
        className
      )}
      {...props}
    />
  );
}

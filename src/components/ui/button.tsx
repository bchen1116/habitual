"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * Volt buttons: pill-shaped, Barlow Condensed 800 uppercase.
 *
 * Every variant carries a fill or a border at rest, so a button is legible as
 * a button before you touch it. That used to be untrue of `ghost`, which was
 * bare text until you hovered it — and on a phone there is no hover, so a
 * dialog's Cancel was indistinguishable from a caption. The tiers below are
 * about *rank*, not about whether something is clickable:
 *
 * - default:     volt fill + ink text — the ONE primary action per screen
 * - secondary:   ink fill ("DARK" in the spec) — everything else prominent
 * - destructive: red fill — irreversible
 * - outline:     2px ink border — tertiary
 * - ghost:       2px hairline border — recessive, but still visibly a control
 * - link:        underlined at rest, for prose-level actions
 *
 * They are deliberately not all one colour: flattening them would remove the
 * only signal that says which action on a screen is the main one.
 */
const buttonVariants = cva(
  // active:translate-y-px is the press feedback. Hover states do nothing on a
  // touch screen, which is where most of this app is used, so without it a tap
  // has no acknowledgement until the work behind it finishes.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-condensed font-bold uppercase tracking-[0.05em] transition-[background-color,border-color,color,transform] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary:
          "bg-foreground text-background hover:bg-foreground/85",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border-2 border-foreground bg-transparent text-foreground hover:bg-accent",
        // border-muted-foreground, not border-border: the divider hairline
        // measures ~1.3:1 against a card in both themes, so a ghost button
        // wearing it would be bordered on paper and still invisible in
        // practice. This clears 5.7:1 light and 6:1 dark — comfortably past
        // the 3:1 that non-text UI needs to read as an edge — while staying
        // lighter than outline's full-ink border.
        ghost:
          "border-2 border-muted-foreground bg-transparent text-muted-foreground hover:border-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-foreground underline underline-offset-4 hover:text-muted-foreground",
      },
      size: {
        default: "h-10 px-5 text-sm",
        sm: "h-9 px-4 text-sm",
        lg: "h-12 px-7 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * Volt buttons: pill-shaped, Barlow Condensed 800 uppercase.
 * - default: volt fill + ink text — the ONE primary action per screen
 * - secondary: ink fill ("DARK" in the spec) — everything else prominent
 * - outline: 2px ink border
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-condensed font-bold uppercase tracking-[0.05em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
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
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-foreground underline-offset-4 hover:underline",
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

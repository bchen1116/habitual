"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Bottom sheet on mobile, centered modal on sm+ screens (docs/overview:
 * same flow, platform-appropriate presentation).
 *
 * Two mobile-keyboard behaviours are handled here rather than per-dialog,
 * since every sheet in the app that contains a text field hits both:
 *
 * 1. Radix autofocuses the first focusable child on open, which on a phone
 *    is enough to summon the keyboard — tapping "Check in" would slam up a
 *    keyboard for a note field nobody asked to fill in. Focus goes to the
 *    sheet itself instead, so the keyboard only appears once you actually
 *    tap the input. Focus still lands inside the dialog, so it stays
 *    trapped and screen readers still announce it. A caller that genuinely
 *    wants a field focused can pass its own `onOpenAutoFocus`.
 * 2. The sheet is bottom-anchored, and iOS doesn't move fixed elements when
 *    the keyboard opens — so it would sit *behind* the keyboard and you
 *    couldn't see what you were typing. It's lifted by the measured
 *    keyboard height, and capped to the space that's left so long content
 *    scrolls instead of overflowing off-screen.
 */
const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, onOpenAutoFocus, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const keyboardInset = useKeyboardInset();

  const composedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={composedRef}
        onOpenAutoFocus={
          onOpenAutoFocus ??
          ((event) => {
            event.preventDefault();
            innerRef.current?.focus();
          })
        }
        className={cn(
          "fixed z-50 grid w-full gap-4 border bg-background p-6 shadow-lg",
          "inset-x-0 bottom-0 rounded-t-xl",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          className
        )}
        // Only while a keyboard is actually up: an unconditional inline
        // `bottom` would override the sm:bottom-auto that centres the
        // desktop modal.
        style={
          keyboardInset > 0
            ? {
                ...style,
                bottom: keyboardInset,
                maxHeight: `calc(100dvh - ${keyboardInset}px)`,
                overflowY: "auto",
              }
            : style
        }
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
};

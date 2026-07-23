import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  xs: "h-6 w-6 text-xs",
  sm: "h-9 w-9 text-sm",
  md: "h-11 w-11 text-base",
  lg: "h-16 w-16 text-xl",
} as const;

const RING_CLASSES = {
  ink: "border-2 border-foreground",
  card: "border-2 border-card",
  none: "",
} as const;

export interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  ring?: keyof typeof RING_CLASSES;
  className?: string;
}

/**
 * Circular avatar: a real photo when `src` is set, otherwise an ink-pill
 * initial (matches the existing counterparty-initial styling in
 * ledger-list.tsx — bg-ink/text-primary — rather than introducing a second
 * fallback look).
 */
export function Avatar({ src, name, size = "sm", ring = "ink", className }: AvatarProps) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink font-bold text-primary",
        SIZE_CLASSES[size],
        RING_CLASSES[ring],
        className
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name ?? "Avatar"} className="h-full w-full object-cover" />
      ) : (
        (name?.trim().charAt(0).toUpperCase() || "?")
      )}
    </span>
  );
}

import { cn } from "@/lib/utils";

import { BrandMark } from "./brand-mark";

/**
 * Neutral stand-in for a missing product photo: a quiet square with a faint
 * HeavyCards mark. Decorative; the product name is always shown as text.
 * Fills its parent, so the parent defines the (square) frame.
 */
export function ImagePlaceholder({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-full items-center justify-center bg-surface text-foreground/15",
        className,
      )}
    >
      <BrandMark className="h-[28%]" />
    </div>
  );
}

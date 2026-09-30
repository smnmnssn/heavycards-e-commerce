import type { ComponentProps } from "react";

import { BagIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** Badge shows "99+" beyond this; the accessible label keeps the exact number. */
const MAX_BADGE_COUNT = 99;

export function cartButtonLabel(count: number): string {
  if (count <= 0) return "Kundvagn, tom";
  return count === 1 ? "Kundvagn, 1 artikel" : `Kundvagn, ${count} artiklar`;
}

type CartButtonProps = Omit<ComponentProps<"button">, "children"> & {
  /** Total item quantity (not number of lines, PROJECT.md §20). */
  count: number;
  /**
   * Increments after each successful add. A new key remounts the icon, which
   * replays the short pulse once (skipped under reduced motion).
   */
  pulseKey?: number;
};

/**
 * Header cart button (presentational). `CartTrigger` supplies the live count
 * and pulse and opens the drawer on click, the only way it ever opens (§19).
 */
export function CartButton({
  count,
  pulseKey = 0,
  className,
  ...props
}: CartButtonProps) {
  const badge = count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count);

  return (
    <button
      type="button"
      aria-label={cartButtonLabel(count)}
      className={cn(
        "relative inline-flex size-11 items-center justify-center rounded-md text-foreground transition-colors duration-150 hover:bg-muted",
        className,
      )}
      {...props}
    >
      <span
        key={pulseKey}
        data-pulse={pulseKey > 0 ? pulseKey : undefined}
        className={cn(
          "inline-flex",
          pulseKey > 0 && "motion-safe:animate-cart-pulse",
        )}
      >
        <BagIcon className="size-6" />
      </span>
      {count > 0 && (
        <span
          aria-hidden="true"
          data-testid="cart-badge"
          className="absolute top-1 right-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-foreground px-1 text-[0.6875rem] leading-none font-semibold text-background tabular-nums"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

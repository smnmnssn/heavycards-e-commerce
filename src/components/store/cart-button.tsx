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
  /** Plays the short confirmation pulse when an item has just been added. */
  pulse?: boolean;
};

/**
 * Header cart trigger. Presentational: in Milestone 5 a client wrapper
 * supplies the live `count`, toggles `pulse` after "Lägg i kundvagn" and opens
 * the cart drawer on click (adding `aria-haspopup="dialog"` then). The drawer
 * only ever opens from this explicit click, never automatically (§19).
 */
export function CartButton({
  count,
  pulse = false,
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
        className={cn("inline-flex", pulse && "motion-safe:animate-cart-pulse")}
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

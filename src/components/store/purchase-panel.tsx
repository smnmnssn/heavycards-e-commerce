import type { ReactNode } from "react";

import { AddToCart } from "@/components/cart/add-to-cart";
import type { CartProductView } from "@/lib/cart/evaluate";
import { formatIsoDate, type IsoDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  availabilityLabels,
  isPurchasable,
  type AvailabilityState,
} from "@/server/domain/catalog";

/*
 * Purchase area of the product page. Catalog rendering (status, release
 * information, preorder terms) lives here; the purchase control is passed in
 * as `action` (see `PurchaseAction`), so catalog rendering stays independent
 * of cart behavior.
 */

const dotClass: Record<AvailabilityState, string> = {
  in_stock: "bg-foreground",
  low_stock: "bg-foreground",
  preorder: "bg-foreground",
  sold_out: "border border-foreground bg-transparent",
  preorder_sold_out: "border border-foreground bg-transparent",
  coming_soon: "border border-foreground bg-transparent",
  discontinued: "border border-muted-foreground bg-transparent",
};

export function AvailabilityStatus({ state }: { state: AvailabilityState }) {
  return (
    <p className="flex items-center gap-2.5 text-sm font-semibold">
      <span
        aria-hidden="true"
        className={cn("inline-block size-2 rounded-full", dotClass[state])}
      />
      {availabilityLabels[state]}
    </p>
  );
}

export function PurchasePanel({
  state,
  releaseDate,
  releasedAlready,
  action,
}: {
  state: AvailabilityState;
  releaseDate: IsoDate | null;
  /** Release date is today or in the past. */
  releasedAlready: boolean;
  action: ReactNode;
}) {
  return (
    <div className="space-y-4 border-t border-border pt-6">
      <AvailabilityStatus state={state} />

      {releaseDate && (
        <p className="text-sm text-muted-foreground">
          {releasedAlready ? "Släpptes" : "Släpps"}{" "}
          <time dateTime={releaseDate} className="text-foreground">
            {formatIsoDate(releaseDate)}
          </time>
        </p>
      )}

      {(state === "preorder" || state === "preorder_sold_out") && (
        <p className="border-l-2 border-foreground pl-3 text-sm">
          Förbeställning: produkten skickas när den har släppts
          {releaseDate && !releasedAlready
            ? `, preliminärt från ${formatIsoDate(releaseDate)}`
            : ""}
          . Den skickas inte direkt.
        </p>
      )}

      {state === "coming_soon" && (
        <p className="text-sm text-muted-foreground">
          Produkten går inte att beställa ännu.
        </p>
      )}

      {state === "discontinued" && (
        <p className="text-sm text-muted-foreground">
          Produkten säljs inte längre av HeavyCards.
        </p>
      )}

      {action}
    </div>
  );
}

/**
 * The purchase control: the real add-to-cart for purchasable products, a
 * disabled state label for sold-out products, and nothing for products that
 * cannot be ordered yet (the panel already explains why).
 */
export function PurchaseAction({
  state,
  product,
}: {
  state: AvailabilityState;
  product: CartProductView;
}) {
  if (state === "coming_soon" || state === "discontinued") {
    return null;
  }
  if (!isPurchasable(state) || !product.available) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-13 w-full items-center justify-center border border-input type-nav text-muted-foreground"
      >
        {availabilityLabels[state]}
      </button>
    );
  }
  return <AddToCart product={product} />;
}

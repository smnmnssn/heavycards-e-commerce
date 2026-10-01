"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { ImagePlaceholder } from "@/components/store/image-placeholder";
import { buttonClasses } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { Skeleton } from "@/components/ui/skeleton";
import { cartConflictMessages, totalQuantity } from "@/lib/cart/cart";
import {
  evaluateCart,
  unavailableMessages,
  type EvaluatedLine,
} from "@/lib/cart/evaluate";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

import { useCartState, useCartStore } from "./cart-provider";
import type { CartStore } from "./cart-store";

export const CART_DRAWER_ID = "kundvagn";

/**
 * Right-side cart drawer on the native modal <dialog>: focus moves inside,
 * the page behind is inert, Escape closes it and focus returns to the cart
 * button. It opens only through `store.open()` from the cart button (or the
 * explicit "Visa kundvagnen" action), never after adding a product.
 *
 * Prices and the subtotal are a display estimate from current server data;
 * "Till kassan" sends the cart to the server, which recalculates everything
 * and either redirects to Stripe or explains (in Swedish) what changed.
 */
export function CartDrawer() {
  const store = useCartStore();
  const { cart, products, hydration, adjustments, isOpen, checkout } =
    useCartState();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const evaluated = useMemo(
    () => evaluateCart(cart, products),
    [cart, products],
  );
  const count = totalQuantity(cart);
  const empty = cart.lines.length === 0;
  const busy =
    checkout.status === "submitting" || checkout.status === "redirecting";
  const canCheckout = !evaluated.incomplete && !evaluated.hasIssues;

  return (
    <dialog
      ref={dialogRef}
      id={CART_DRAWER_ID}
      aria-labelledby={`${CART_DRAWER_ID}-rubrik`}
      data-side="right"
      className="drawer max-sm:w-[calc(100vw-1.5rem)] sm:w-[min(28rem,calc(100vw-3rem))]"
      onClose={() => store.close()}
      onClick={(event) => {
        // Clicks on the backdrop target the dialog element itself.
        if (event.target === event.currentTarget) store.close();
      }}
    >
      <div className="flex h-full flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border pr-2 pl-5">
          <h2 id={`${CART_DRAWER_ID}-rubrik`} className="type-nav">
            Din kundvagn
            {count > 0 && (
              <span className="ml-2 font-normal text-muted-foreground">
                ({count})
              </span>
            )}
          </h2>
          <button
            type="button"
            aria-label="Stäng kundvagnen"
            onClick={() => store.close()}
            className="inline-flex size-11 items-center justify-center rounded-md transition-colors hover:bg-muted"
          >
            <CloseIcon className="size-6" />
          </button>
        </header>

        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
            <p className="type-h3">Din kundvagn är tom.</p>
            <Link
              href="/pokemon-tcg"
              onClick={() => store.close()}
              className={buttonClasses({ variant: "secondary" })}
            >
              Utforska sortimentet
            </Link>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
              {hydration === "error" && (
                <div
                  role="alert"
                  className="mt-4 border-l-2 border-destructive bg-surface px-4 py-3 text-sm"
                >
                  <p>Det gick inte att hämta aktuella priser just nu.</p>
                  <button
                    type="button"
                    onClick={() => void store.refresh()}
                    className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
                  >
                    Försök igen
                  </button>
                </div>
              )}
              <ul
                aria-label="Produkter i kundvagnen"
                className="divide-y divide-border"
              >
                {evaluated.lines.map((entry) => (
                  <CartLineItem
                    key={entry.line.productId}
                    entry={entry}
                    adjustedFrom={adjustments[entry.line.productId]}
                    store={store}
                  />
                ))}
              </ul>
            </div>

            <footer className="shrink-0 space-y-4 border-t border-border px-5 pt-5 pb-6">
              {evaluated.conflict && (
                <p
                  role="alert"
                  className="border-l-2 border-destructive pl-3 text-sm"
                >
                  {cartConflictMessages[evaluated.conflict]}
                </p>
              )}
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt>Delsumma</dt>
                  <dd className="font-semibold tabular-nums">
                    {evaluated.incomplete ? (
                      <Skeleton className="h-5 w-20" />
                    ) : (
                      formatPrice(evaluated.subtotalAmount)
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 text-muted-foreground">
                  <dt>Frakt</dt>
                  <dd>Beräknas i kassan</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Priser inklusive moms. Slutligt pris bekräftas i kassan.
              </p>
              {checkout.status === "error" && (
                <div
                  role="alert"
                  data-testid="checkout-error"
                  className="border-l-2 border-destructive pl-3 text-sm"
                >
                  <p className="font-semibold">{checkout.message.title}</p>
                  {checkout.message.details.length > 0 && (
                    <ul className="mt-1.5 list-disc space-y-1 pl-4">
                      {checkout.message.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={!canCheckout || busy}
                aria-busy={busy}
                aria-describedby={`${CART_DRAWER_ID}-kassa`}
                onClick={() => void store.checkout()}
                className={cn(
                  buttonClasses({ size: "lg", fullWidth: true }),
                  "disabled:opacity-40",
                  busy && "disabled:opacity-70",
                )}
              >
                {checkout.status === "submitting"
                  ? "Startar betalningen…"
                  : checkout.status === "redirecting"
                    ? "Skickar dig till betalningen…"
                    : "Till kassan"}
              </button>
              <p
                id={`${CART_DRAWER_ID}-kassa`}
                className="text-center text-sm text-muted-foreground"
              >
                {evaluated.hasIssues
                  ? "Åtgärda markerade produkter för att gå till kassan."
                  : "Du betalar säkert via Stripe. Frakt och totalbelopp visas där innan du betalar."}
              </p>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}

function CartLineItem({
  entry,
  adjustedFrom,
  store,
}: {
  entry: EvaluatedLine;
  adjustedFrom: number | undefined;
  store: CartStore;
}) {
  const { line, product, issue, lineTotalAmount } = entry;

  if (!product) {
    return (
      <li className="flex gap-4 py-5" aria-busy="true">
        <Skeleton className="size-20 shrink-0 rounded-none" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
          <span className="sr-only">Hämtar produkt…</span>
        </div>
      </li>
    );
  }

  const name = product.name ?? "Produkt som inte längre finns";
  const unavailable = issue === "unavailable";

  return (
    <li className="flex gap-4 py-5" data-testid="cart-line">
      <div
        className={cn(
          "relative size-20 shrink-0 overflow-hidden bg-surface",
          unavailable && "opacity-50",
        )}
      >
        {product.image ? (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            width={product.image.width}
            height={product.image.height}
            sizes="80px"
            className="size-full object-contain p-1.5"
          />
        ) : (
          <ImagePlaceholder />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {product.setName && (
              <p className="type-eyebrow text-[0.625rem] text-muted-foreground">
                {product.setName}
              </p>
            )}
            {product.slug ? (
              <Link
                href={`/pokemon-tcg/${product.slug}`}
                onClick={() => store.close()}
                className="block text-sm leading-snug font-semibold break-words underline-offset-4 hover:underline"
              >
                {name}
              </Link>
            ) : (
              <p className="text-sm leading-snug font-semibold">{name}</p>
            )}
            {product.unitPriceAmount !== null && (
              <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                {formatPrice(product.unitPriceAmount)}
                <span className="sr-only"> per styck</span>
              </p>
            )}
          </div>
          {lineTotalAmount !== null && (
            <p className="shrink-0 text-sm font-semibold tabular-nums">
              {formatPrice(lineTotalAmount)}
            </p>
          )}
        </div>

        {unavailable && product.unavailableReason && (
          <p className="mt-2 text-sm font-medium text-destructive" role="note">
            {unavailableMessages[product.unavailableReason]}
          </p>
        )}
        {!unavailable && adjustedFrom !== undefined && (
          <p className="mt-2 text-sm" role="note">
            Antalet har ändrats från {adjustedFrom} till {line.quantity}{" "}
            eftersom det bara finns så många kvar.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {unavailable ? (
            <span className="text-sm text-muted-foreground">
              Antal: {line.quantity}
            </span>
          ) : (
            <QuantityStepper
              size="sm"
              label={`Antal för ${name}`}
              value={line.quantity}
              max={product.maxQuantity}
              onChange={(quantity) =>
                store.setQuantity(line.productId, quantity)
              }
            />
          )}
          <button
            type="button"
            aria-label={`Ta bort ${name} från kundvagnen`}
            onClick={() => store.removeItem(line.productId)}
            className="inline-flex min-h-11 items-center px-1 text-sm underline underline-offset-4 hover:decoration-2"
          >
            Ta bort
          </button>
        </div>
      </div>
    </li>
  );
}

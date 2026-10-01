import type { Metadata } from "next";

import {
  ClearPurchasedItems,
  RefreshWhilePending,
} from "@/components/cart/checkout-return";
import { OpenCartButton } from "@/components/cart/open-cart-button";
import { PageHeader } from "@/components/store/headings";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { db } from "@/lib/db/client";
import { formatPrice } from "@/lib/money";
import {
  checkoutReturnState,
  parseCheckoutSessionId,
  type CheckoutReturnState,
} from "@/server/checkout/return-state";

export const metadata: Metadata = {
  title: "Din beställning",
  robots: { index: false, follow: false },
};

/**
 * Stripe's success URL. Reaching it proves nothing about payment: anyone
 * can open it. The page therefore shows only what the database says, which
 * changes to PAID solely from Stripe's verified state (webhooks or
 * reconciliation). The unguessable session ID in the URL selects the order;
 * the page shows its public number, state and, once paid, the products and
 * total, never personal data. While pending it re-reads the database a few
 * times; Stripe normally waits for the webhook before redirecting here.
 */
export default async function CheckoutReturnPage({
  searchParams,
}: PageProps<"/kassa/bekraftelse">) {
  const sessionId = parseCheckoutSessionId((await searchParams).session_id);
  const order = sessionId
    ? await db.order.findUnique({
        where: { stripeCheckoutSessionId: sessionId },
        select: {
          orderNumber: true,
          paymentStatus: true,
          totalAmount: true,
          checkoutAttemptId: true,
          items: {
            select: {
              productId: true,
              productNameSnapshot: true,
              quantity: true,
            },
            orderBy: { id: "asc" },
          },
        },
      })
    : null;
  const state = checkoutReturnState(order);

  return (
    <Container className="py-16 sm:py-24 lg:py-32">
      <ReturnContent state={state} />
    </Container>
  );
}

function ReturnContent({ state }: { state: CheckoutReturnState }) {
  switch (state.kind) {
    case "processing":
      return (
        <>
          <PageHeader
            eyebrow={`Beställning ${state.orderNumber}`}
            title="Tack! Vi kontrollerar din betalning."
            lead="Vi har tagit emot din beställning och väntar på bekräftelse av betalningen från vår betalleverantör. Det brukar gå snabbt, men kan ibland ta en stund."
          />
          <div className="prose-store mt-8">
            <p>
              När betalningen är bekräftad skickar vi en orderbekräftelse till
              din e-postadress. Om betalningen inte går igenom skickas ingen
              orderbekräftelse och beställningen genomförs inte.
            </p>
          </div>
          <p
            role="status"
            className="mt-6 text-sm text-muted-foreground"
            aria-live="polite"
          >
            Sidan uppdateras automatiskt när betalningen är bekräftad.
          </p>
          <RefreshWhilePending />
          <div className="mt-10">
            <ButtonLink href="/" variant="secondary">
              Till startsidan
            </ButtonLink>
          </div>
        </>
      );
    case "paid":
      return (
        <>
          <PageHeader
            eyebrow={`Beställning ${state.orderNumber}`}
            title="Tack för din beställning!"
            lead="Betalningen är bekräftad. Vi förbereder nu din beställning för leverans med PostNord."
          />
          <section
            aria-labelledby="bestallda-produkter"
            className="mt-10 max-w-xl"
          >
            <h2 id="bestallda-produkter" className="type-nav">
              Beställda produkter
            </h2>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {state.lines.map((line) => (
                <li
                  key={line.productId}
                  className="flex justify-between gap-4 py-3 text-sm"
                >
                  <span>{line.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {line.quantity} st
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between text-sm font-semibold">
              <span>Totalt inklusive moms och frakt</span>
              <span className="tabular-nums">
                {formatPrice(state.totalAmount)}
              </span>
            </p>
          </section>
          {state.attemptHash && (
            <ClearPurchasedItems
              attemptHash={state.attemptHash}
              lines={state.lines.map(({ productId, quantity }) => ({
                productId,
                quantity,
              }))}
            />
          )}
          <div className="mt-10">
            <ButtonLink href="/" variant="secondary">
              Till startsidan
            </ButtonLink>
          </div>
        </>
      );
    case "refunded":
      return (
        <>
          <PageHeader
            eyebrow={`Beställning ${state.orderNumber}`}
            title="Beställningen är återbetald"
            lead="Betalningen för den här beställningen har betalats tillbaka. Kontakta oss om du har frågor."
          />
          <div className="mt-10">
            <ButtonLink href="/kontakt" variant="secondary">
              Kontakta oss
            </ButtonLink>
          </div>
        </>
      );
    case "expired":
    case "failed":
      return (
        <>
          <PageHeader
            eyebrow={`Beställning ${state.orderNumber}`}
            title={
              state.kind === "failed"
                ? "Betalningen gick inte igenom"
                : "Betalningen genomfördes inte"
            }
            lead={
              state.kind === "failed"
                ? "Betalningen godkändes inte, så beställningen genomförs inte och du debiteras inte. Din kundvagn finns kvar om du vill försöka igen."
                : "Betalningen slutfördes inte i tid, så beställningen genomförs inte. Din kundvagn finns kvar om du vill försöka igen."
            }
          />
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <OpenCartButton />
            <ButtonLink href="/pokemon-tcg" variant="secondary">
              Fortsätt handla
            </ButtonLink>
          </div>
        </>
      );
    case "unknown":
      return (
        <>
          <PageHeader
            eyebrow="Kassan"
            title="Vi hittade ingen beställning"
            lead="Länken innehåller ingen beställning som vi känner till. Om du har betalat får du en orderbekräftelse via e-post när betalningen är bekräftad."
          />
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <OpenCartButton />
            <ButtonLink href="/kontakt" variant="secondary">
              Kontakta oss
            </ButtonLink>
          </div>
        </>
      );
  }
}

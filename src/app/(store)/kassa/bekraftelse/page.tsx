import type { Metadata } from "next";

import { OpenCartButton } from "@/components/cart/open-cart-button";
import { PageHeader } from "@/components/store/headings";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { db } from "@/lib/db/client";
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
 * changes to PAID solely through verified Stripe webhooks (Milestone 9).
 * The session ID in the URL only selects which order to describe, and only
 * its public order number and payment state are shown.
 */
export default async function CheckoutReturnPage({
  searchParams,
}: PageProps<"/kassa/bekraftelse">) {
  const sessionId = parseCheckoutSessionId((await searchParams).session_id);
  const order = sessionId
    ? await db.order.findUnique({
        where: { stripeCheckoutSessionId: sessionId },
        select: { orderNumber: true, paymentStatus: true },
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
            lead="Betalningen är bekräftad. Vi skickar en orderbekräftelse till din e-postadress."
          />
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
    case "not_completed":
      return (
        <>
          <PageHeader
            eyebrow={`Beställning ${state.orderNumber}`}
            title="Betalningen genomfördes inte"
            lead="Beställningen slutfördes inte och ingen orderbekräftelse skickas. Din kundvagn finns kvar om du vill försöka igen."
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

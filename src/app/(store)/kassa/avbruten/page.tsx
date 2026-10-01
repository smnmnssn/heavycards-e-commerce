import type { Metadata } from "next";

import { OpenCartButton } from "@/components/cart/open-cart-button";
import { PageHeader } from "@/components/store/headings";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Betalningen avbröts",
  robots: { index: false, follow: false },
};

/**
 * Stripe's cancel URL: the customer left the payment page. Nothing is
 * cleared; the cart in browser storage is unchanged. Clicking "Till kassan"
 * again with the same cart resumes the same payment session.
 */
export default function CheckoutCancelledPage() {
  return (
    <Container className="py-16 sm:py-24 lg:py-32">
      <PageHeader
        eyebrow="Kassan"
        title="Betalningen avbröts"
        lead="Du lämnade betalningen innan den slutfördes. Din kundvagn finns kvar, så du kan fortsätta när du vill."
      />
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <OpenCartButton />
        <ButtonLink href="/pokemon-tcg" variant="secondary">
          Fortsätt handla
        </ButtonLink>
      </div>
    </Container>
  );
}

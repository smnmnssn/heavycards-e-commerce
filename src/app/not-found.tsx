import type { Metadata } from "next";

import { PageHeader } from "@/components/store/headings";
import { StoreShell } from "@/components/store/store-shell";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Sidan hittades inte",
  robots: { index: false },
};

// Unmatched URLs render outside the (store) layout, so the shell is added here.
export default function NotFound() {
  return (
    <StoreShell>
      <Container className="py-20 sm:py-28 lg:py-36">
        <PageHeader
          eyebrow="404"
          title="Sidan hittades inte"
          lead="Sidan du letar efter finns inte eller har flyttats."
        />
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/">Till startsidan</ButtonLink>
          <ButtonLink href="/pokemon-tcg" variant="secondary">
            Se sortimentet
          </ButtonLink>
        </div>
      </Container>
    </StoreShell>
  );
}

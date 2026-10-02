import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { PageHeader } from "@/components/store/headings";
import { JsonLdScript } from "@/components/store/json-ld";
import { ProductListing } from "@/components/store/product-listing";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { env } from "@/lib/env/server";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { pagedTitle, pageMetadata } from "@/lib/seo/metadata";
import { loadListing } from "@/server/catalog/listing";
import { NEW_ARRIVALS_WINDOW_DAYS } from "@/server/domain/catalog";
import {
  listingHref,
  parseListingParams,
} from "@/server/domain/catalog-params";

const BREADCRUMBS = [{ label: "Hem", href: "/" }, { label: "Nyheter" }];
const PATH = "/nyheter";

export async function generateMetadata({
  searchParams,
}: PageProps<"/nyheter">): Promise<Metadata> {
  const { page } = parseListingParams(await searchParams);
  return pageMetadata({
    title: pagedTitle("Nyheter – nya Pokémon TCG-produkter", page),
    description:
      "Nya förseglade Pokémon TCG-produkter hos HeavyCards, senast inkomna först.",
    path: listingHref(PATH, { page }),
  });
}

/** Recently published products, newest first (no filters: a short list). */
export default async function NewArrivalsPage({
  searchParams,
}: PageProps<"/nyheter">) {
  const { page } = parseListingParams(await searchParams);
  const params = { ...parseListingParams({}), page };
  const listing = await loadListing({
    params,
    scope: "new",
    defaultSort: "newest",
    now: new Date(),
  });
  if (page > listing.pageCount) notFound();

  return (
    <Container className="py-10 sm:py-14">
      <JsonLdScript data={breadcrumbJsonLd(env.siteUrl, BREADCRUMBS)} />
      <Breadcrumbs items={BREADCRUMBS} />
      <PageHeader
        className="mt-8"
        eyebrow="Nytt i butiken"
        title="Nyheter"
        lead={`Produkter som har kommit in de senaste ${NEW_ARRIVALS_WINDOW_DAYS} dagarna, senast inkomna först.`}
      />
      <ProductListing
        products={listing.cards}
        page={listing.page}
        pageCount={listing.pageCount}
        hrefForPage={(next) => listingHref(PATH, { page: next })}
        emptyTitle="Inga nyheter just nu"
        emptyContent="Nya produkter visas här när de kommer in."
        emptyAction={
          <ButtonLink href="/pokemon-tcg" variant="secondary">
            Se hela sortimentet
          </ButtonLink>
        }
      />
    </Container>
  );
}

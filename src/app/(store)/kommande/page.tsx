import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { PageHeader } from "@/components/store/headings";
import { ProductListing } from "@/components/store/product-listing";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { pageMetadata } from "@/lib/seo/metadata";
import { loadListing } from "@/server/catalog/listing";
import {
  listingHref,
  parseListingParams,
} from "@/server/domain/catalog-params";

const PATH = "/kommande";

export async function generateMetadata({
  searchParams,
}: PageProps<"/kommande">): Promise<Metadata> {
  const { page } = parseListingParams(await searchParams);
  return pageMetadata({
    title: "Kommande Pokémon TCG-släpp",
    description:
      "Kommande Pokémon TCG-produkter och förbeställningar hos HeavyCards, med släppdatum.",
    path: listingHref(PATH, { page }),
  });
}

/**
 * Upcoming releases: COMING_SOON products, preorders and products with a
 * future release date, in release order. Cards state per product whether it
 * can be preordered, so nothing implies that every release is orderable.
 */
export default async function UpcomingPage({
  searchParams,
}: PageProps<"/kommande">) {
  const { page } = parseListingParams(await searchParams);
  const listing = await loadListing({
    params: { ...parseListingParams({}), page },
    scope: "upcoming",
    defaultSort: "release",
    now: new Date(),
  });
  if (page > listing.pageCount) notFound();

  return (
    <Container className="py-10 sm:py-14">
      <Breadcrumbs
        items={[{ label: "Hem", href: "/" }, { label: "Kommande" }]}
      />
      <PageHeader
        className="mt-8"
        eyebrow="Släppkalender"
        title="Kommande"
        lead="Kommande Pokémon TCG-släpp i släppordning."
      />
      <dl className="mt-8 grid max-w-3xl gap-4 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <dt className="shrink-0">
            <Badge>Förbeställ</Badge>
          </dt>
          <dd className="text-muted-foreground">
            Kan beställas nu och skickas när produkten har släppts.
          </dd>
        </div>
        <div className="flex items-start gap-3">
          <dt className="shrink-0">
            <Badge variant="outline">Kommer snart</Badge>
          </dt>
          <dd className="text-muted-foreground">
            Kan inte beställas ännu. Håll utkik efter släppet.
          </dd>
        </div>
      </dl>
      <ProductListing
        products={listing.cards}
        page={listing.page}
        pageCount={listing.pageCount}
        hrefForPage={(next) => listingHref(PATH, { page: next })}
        emptyTitle="Inga kommande släpp just nu"
        emptyContent="Nya släpp visas här så snart de är annonserade."
        emptyAction={
          <ButtonLink href="/pokemon-tcg" variant="secondary">
            Se hela sortimentet
          </ButtonLink>
        }
      />
    </Container>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { CatalogToolbar } from "@/components/store/catalog-toolbar";
import { PageHeader } from "@/components/store/headings";
import { JsonLdScript } from "@/components/store/json-ld";
import { LandingText } from "@/components/store/landing-text";
import { ProductListing } from "@/components/store/product-listing";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { setPath } from "@/lib/catalog-paths";
import { formatIsoDate, stockholmToday } from "@/lib/dates";
import { env } from "@/lib/env/server";
import { breadcrumbJsonLd, collectionPageJsonLd } from "@/lib/seo/json-ld";
import {
  setFallbackDescription,
  setMetaDescription,
  setSeoTitle,
} from "@/lib/seo/catalog-defaults";
import { pagedTitle, pageMetadata } from "@/lib/seo/metadata";
import {
  LISTING_PAGE_SIZE,
  loadFilterOptions,
  loadListing,
  sanitizeFilters,
  toOptions,
} from "@/server/catalog/listing";
import { notFoundUnlessMoved } from "@/server/catalog/not-found";
import { landingCopy } from "@/server/catalog/presenters";
import { getSet } from "@/server/data/catalog";
import {
  listingHref,
  listingSeo,
  parseListingParams,
} from "@/server/domain/catalog-params";

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/set/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const set = await getSet(slug);
  if (!set) return {};

  const listingParams = parseListingParams(await searchParams);
  const seo = listingSeo(
    setPath(slug),
    listingParams,
    set.listableProductCount,
  );
  return pageMetadata({
    title: pagedTitle(setSeoTitle(set), listingParams.page),
    description: setMetaDescription(set),
    path: seo.canonical,
    index: seo.index,
  });
}

export default async function SetPage({
  params,
  searchParams,
}: PageProps<"/set/[slug]">) {
  const { slug } = await params;
  const set = await getSet(slug);
  if (!set) return notFoundUnlessMoved(setPath(slug));

  const now = new Date();
  const path = setPath(slug);
  const options = await loadFilterOptions(now);
  const rawParams = parseListingParams(await searchParams);
  const listingParams = sanitizeFilters(
    { ...rawParams, setSlug: undefined },
    options,
  );
  const listing = await loadListing({
    params: listingParams,
    setSlug: slug,
    defaultSort: "newest",
    now,
  });
  if (listingParams.page > listing.pageCount) notFound();

  const released = set.releaseDate && set.releaseDate <= stockholmToday(now);
  const breadcrumbs = [
    { label: "Hem", href: "/" },
    { label: "Pokémon TCG", href: "/pokemon-tcg" },
    { label: set.name },
  ];
  const copy = landingCopy(set.description, setFallbackDescription(set.name));
  const indexable = listingSeo(path, rawParams, set.listableProductCount).index;

  return (
    <Container className="py-10 sm:py-14">
      <JsonLdScript
        data={[
          breadcrumbJsonLd(env.siteUrl, breadcrumbs),
          ...(indexable
            ? [
                collectionPageJsonLd({
                  siteUrl: env.siteUrl,
                  path: listingHref(path, { page: listing.page }),
                  name: set.name,
                  description: setMetaDescription(set),
                  numberOfItems: listing.total,
                  offset: (listing.page - 1) * LISTING_PAGE_SIZE,
                  items: listing.cards,
                }),
              ]
            : []),
        ]}
      />
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        className="mt-8"
        eyebrow="Pokémon-set"
        title={set.name}
        lead={
          <>
            {set.releaseDate && (
              <span className="block text-foreground">
                {released ? "Släpptes" : "Släpps"}{" "}
                <time dateTime={set.releaseDate}>
                  {formatIsoDate(set.releaseDate)}
                </time>
              </span>
            )}
            <span className="mt-2 block">{copy.lead}</span>
          </>
        }
      />
      <div className="mt-10 lg:mt-14">
        <CatalogToolbar
          action={path}
          params={listingParams}
          categories={toOptions(options.categories)}
          resultCount={listing.total}
        />
        <ProductListing
          products={listing.cards}
          page={listing.page}
          pageCount={listing.pageCount}
          hrefForPage={(page) => listingHref(path, { ...listingParams, page })}
          emptyTitle={
            listingParams.categorySlug || listingParams.inStockOnly
              ? "Inga produkter matchar filtret"
              : "Inga produkter från det här setet just nu"
          }
          emptyAction={
            <ButtonLink href="/pokemon-tcg" variant="secondary">
              Se hela sortimentet
            </ButtonLink>
          }
        />
      </div>
      {listing.page === 1 && (
        <LandingText title={`Om ${set.name}`} paragraphs={copy.body} />
      )}
    </Container>
  );
}

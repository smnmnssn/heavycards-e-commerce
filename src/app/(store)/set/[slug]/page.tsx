import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { CatalogToolbar } from "@/components/store/catalog-toolbar";
import { PageHeader } from "@/components/store/headings";
import { JsonLdScript } from "@/components/store/json-ld";
import { ProductListing } from "@/components/store/product-listing";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { setPath } from "@/lib/catalog-paths";
import { formatIsoDate, stockholmToday } from "@/lib/dates";
import { env } from "@/lib/env/server";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import {
  setFallbackDescription,
  setMetaDescription,
  setSeoTitle,
} from "@/lib/seo/catalog-defaults";
import { excerpt, firstText, pageMetadata } from "@/lib/seo/metadata";
import {
  loadFilterOptions,
  loadListing,
  sanitizeFilters,
  toOptions,
} from "@/server/catalog/listing";
import { notFoundUnlessMoved } from "@/server/catalog/not-found";
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

  const seo = listingSeo(
    `/set/${slug}`,
    parseListingParams(await searchParams),
  );
  return pageMetadata({
    title: setSeoTitle(set),
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
  const path = `/set/${slug}`;
  const options = await loadFilterOptions(now);
  const listingParams = sanitizeFilters(
    { ...parseListingParams(await searchParams), setSlug: undefined },
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

  return (
    <Container className="py-10 sm:py-14">
      <JsonLdScript data={breadcrumbJsonLd(env.siteUrl, breadcrumbs)} />
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
            <span className="mt-2 block">
              {excerpt(
                firstText(set.description) ?? setFallbackDescription(set.name),
                400,
              )}
            </span>
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
    </Container>
  );
}

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
import { categoryPath } from "@/lib/catalog-paths";
import { env } from "@/lib/env/server";
import { breadcrumbJsonLd, collectionPageJsonLd } from "@/lib/seo/json-ld";
import {
  categoryFallbackDescription,
  categoryMetaDescription,
  categorySeoTitle,
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
import { getCategory } from "@/server/data/catalog";
import {
  listingHref,
  listingSeo,
  parseListingParams,
} from "@/server/domain/catalog-params";

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/kategori/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return {};

  const listingParams = parseListingParams(await searchParams);
  const seo = listingSeo(
    categoryPath(slug),
    listingParams,
    category.listableProductCount,
  );
  return pageMetadata({
    title: pagedTitle(categorySeoTitle(category), listingParams.page),
    description: categoryMetaDescription(category),
    path: seo.canonical,
    index: seo.index,
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<"/kategori/[slug]">) {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return notFoundUnlessMoved(categoryPath(slug));

  const now = new Date();
  const path = categoryPath(slug);
  const options = await loadFilterOptions(now);
  const rawParams = parseListingParams(await searchParams);
  const listingParams = sanitizeFilters(
    { ...rawParams, categorySlug: undefined },
    options,
  );
  const listing = await loadListing({
    params: listingParams,
    categorySlug: slug,
    defaultSort: "newest",
    now,
  });
  if (listingParams.page > listing.pageCount) notFound();

  const breadcrumbs = [
    { label: "Hem", href: "/" },
    { label: "Pokémon TCG", href: "/pokemon-tcg" },
    { label: category.name },
  ];
  const copy = landingCopy(
    category.description,
    categoryFallbackDescription(category.name),
  );
  const indexable = listingSeo(
    path,
    rawParams,
    category.listableProductCount,
  ).index;

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
                  name: category.name,
                  description: categoryMetaDescription(category),
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
        eyebrow="Kategori"
        title={category.name}
        lead={copy.lead}
      />
      <div className="mt-10 lg:mt-14">
        <CatalogToolbar
          action={path}
          params={listingParams}
          sets={toOptions(options.sets)}
          resultCount={listing.total}
        />
        <ProductListing
          products={listing.cards}
          page={listing.page}
          pageCount={listing.pageCount}
          hrefForPage={(page) => listingHref(path, { ...listingParams, page })}
          emptyTitle={
            listing.total === 0 &&
            !listingParams.setSlug &&
            !listingParams.inStockOnly
              ? "Inga produkter i den här kategorin just nu"
              : "Inga produkter matchar filtret"
          }
          emptyAction={
            <ButtonLink href="/pokemon-tcg" variant="secondary">
              Se hela sortimentet
            </ButtonLink>
          }
        />
      </div>
      {listing.page === 1 && (
        <LandingText title={`Om ${category.name}`} paragraphs={copy.body} />
      )}
    </Container>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { CatalogToolbar } from "@/components/store/catalog-toolbar";
import { PageHeader } from "@/components/store/headings";
import { JsonLdScript } from "@/components/store/json-ld";
import { ProductListing } from "@/components/store/product-listing";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { env } from "@/lib/env/server";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { excerpt, firstText, pageMetadata } from "@/lib/seo/metadata";
import {
  loadFilterOptions,
  loadListing,
  sanitizeFilters,
  toOptions,
} from "@/server/catalog/listing";
import { getCategory } from "@/server/data/catalog";
import {
  listingHref,
  listingSeo,
  parseListingParams,
} from "@/server/domain/catalog-params";

const categoryDescription = (name: string) =>
  `${name} för Pokémon TCG hos HeavyCards. Förseglade produkter med priser inklusive moms och leverans inom Sverige.`;

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/kategori/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return {};

  const seo = listingSeo(
    `/kategori/${slug}`,
    parseListingParams(await searchParams),
  );
  return pageMetadata({
    title: firstText(category.seoTitle) ?? `${category.name} – Pokémon TCG`,
    description:
      firstText(category.seoDescription, category.description) ??
      categoryDescription(category.name),
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
  if (!category) notFound();

  const now = new Date();
  const path = `/kategori/${slug}`;
  const options = await loadFilterOptions(now);
  const listingParams = sanitizeFilters(
    { ...parseListingParams(await searchParams), categorySlug: undefined },
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

  return (
    <Container className="py-10 sm:py-14">
      <JsonLdScript data={breadcrumbJsonLd(env.siteUrl, breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        className="mt-8"
        eyebrow="Kategori"
        title={category.name}
        lead={excerpt(
          firstText(category.description) ?? categoryDescription(category.name),
          400,
        )}
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
    </Container>
  );
}

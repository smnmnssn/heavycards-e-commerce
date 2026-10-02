import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/store/breadcrumbs";
import { CatalogToolbar } from "@/components/store/catalog-toolbar";
import { PageHeader } from "@/components/store/headings";
import { JsonLdScript } from "@/components/store/json-ld";
import { ProductListing } from "@/components/store/product-listing";
import { CategoryTiles } from "@/components/store/taxonomy-links";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { env } from "@/lib/env/server";
import { breadcrumbJsonLd, collectionPageJsonLd } from "@/lib/seo/json-ld";
import { pagedTitle, pageMetadata } from "@/lib/seo/metadata";
import {
  LISTING_PAGE_SIZE,
  loadFilterOptions,
  loadListing,
  sanitizeFilters,
  toOptions,
} from "@/server/catalog/listing";
import {
  hasFilterOrSort,
  listingHref,
  listingSeo,
  parseListingParams,
} from "@/server/domain/catalog-params";

const PATH = "/pokemon-tcg";
const TITLE = "Pokémon TCG";
const SEO_TITLE = "Pokémon TCG – booster boxes, ETB och mer";
const DESCRIPTION =
  "Förseglade Pokémon TCG-produkter: booster boxes, Elite Trainer Boxes, booster packs, collection boxes och tins. Priser inklusive moms och leverans inom Sverige.";

const breadcrumbs = [{ label: "Hem", href: "/" }, { label: TITLE }];

export async function generateMetadata({
  searchParams,
}: PageProps<"/pokemon-tcg">): Promise<Metadata> {
  const params = parseListingParams(await searchParams);
  const seo = listingSeo(PATH, params);
  return pageMetadata({
    title: pagedTitle(SEO_TITLE, params.page),
    description: DESCRIPTION,
    path: seo.canonical,
    index: seo.index,
  });
}

export default async function PokemonTcgPage({
  searchParams,
}: PageProps<"/pokemon-tcg">) {
  const now = new Date();
  const options = await loadFilterOptions(now);
  const rawParams = parseListingParams(await searchParams);
  const params = sanitizeFilters(rawParams, options);
  const listing = await loadListing({ params, defaultSort: "newest", now });
  if (params.page > listing.pageCount) notFound();

  const filtered = hasFilterOrSort(params);
  const indexable = listingSeo(PATH, rawParams).index;

  return (
    <Container className="py-10 sm:py-14">
      <JsonLdScript
        data={[
          breadcrumbJsonLd(env.siteUrl, breadcrumbs),
          ...(indexable
            ? [
                collectionPageJsonLd({
                  siteUrl: env.siteUrl,
                  path: listingHref(PATH, { page: listing.page }),
                  name: TITLE,
                  description: DESCRIPTION,
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
        eyebrow="Sortiment"
        title={TITLE}
        lead="Förseglade produkter för samlare och spelare. Utforska efter kategori, set eller hela sortimentet nedan."
      />

      {!filtered && params.page === 1 && (
        <div className="mt-12 grid gap-12 lg:mt-16">
          <section aria-labelledby="kategorier">
            <h2 id="kategorier" className="mb-4 type-eyebrow">
              Kategorier
            </h2>
            <CategoryTiles categories={options.categories} />
          </section>
        </div>
      )}

      <div className="mt-12 lg:mt-16">
        <CatalogToolbar
          action={PATH}
          params={params}
          categories={toOptions(options.categories)}
          sets={toOptions(options.sets)}
          resultCount={listing.total}
        />
        <ProductListing
          products={listing.cards}
          page={listing.page}
          pageCount={listing.pageCount}
          hrefForPage={(page) => listingHref(PATH, { ...params, page })}
          emptyTitle="Inga produkter matchar filtret"
          emptyContent="Prova att ta bort ett eller flera filter."
          emptyAction={
            <ButtonLink href={PATH} variant="secondary">
              Visa alla produkter
            </ButtonLink>
          }
        />
      </div>
    </Container>
  );
}

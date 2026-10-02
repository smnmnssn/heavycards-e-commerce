import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CatalogToolbar } from "@/components/store/catalog-toolbar";
import { EmptyState } from "@/components/store/empty-state";
import { HeaderSearch } from "@/components/store/header-search";
import { ProductListing } from "@/components/store/product-listing";
import { CategoryTiles } from "@/components/store/taxonomy-links";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { db } from "@/lib/db/client";
import { pageMetadata } from "@/lib/seo/metadata";
import { listCategories } from "@/server/data/catalog-queries";
import { loadListing } from "@/server/catalog/listing";
import {
  SEARCH_SORTS,
  listingHref,
  parseListingParams,
  searchTerms,
} from "@/server/domain/catalog-params";

const PATH = "/sok";

export async function generateMetadata({
  searchParams,
}: PageProps<"/sok">): Promise<Metadata> {
  const { query } = parseListingParams(await searchParams);
  // Search result pages are never indexed (PROJECT.md §65): any text can be
  // put in a link, so indexable results would invite spam pages. Crawlers
  // may still follow the product links.
  return pageMetadata({
    title: query ? `Sökresultat för ”${query}”` : "Sök",
    description: "Sök bland förseglade Pokémon TCG-produkter hos HeavyCards.",
    path: PATH,
    index: false,
  });
}

export default async function SearchPage({ searchParams }: PageProps<"/sok">) {
  const raw = parseListingParams(await searchParams);
  // Search filters by availability and sort only; category/set are ignored.
  const params = { ...raw, categorySlug: undefined, setSlug: undefined };
  const terms = searchTerms(params.query);

  return (
    <Container className="py-10 sm:py-14">
      <h1 className="type-h1">Sök</h1>
      {params.query && (
        <p className="mt-3 type-lead text-muted-foreground">
          Resultat för{" "}
          <span className="font-semibold text-foreground">
            ”{params.query}”
          </span>
        </p>
      )}
      <HeaderSearch
        className="mt-6 max-w-xl"
        defaultValue={params.query}
        label="Sök i sortimentet"
      />
      {terms.length === 0 ? (
        <EmptySearch hasQuery={params.query.length > 0} />
      ) : (
        <SearchResults params={params} terms={terms} />
      )}
    </Container>
  );
}

async function SearchResults({
  params,
  terms,
}: {
  params: ReturnType<typeof parseListingParams>;
  terms: string[];
}) {
  const listing = await loadListing({
    params,
    searchTerms: terms,
    defaultSort: "relevance",
    now: new Date(),
  });
  if (params.page > listing.pageCount) notFound();

  return (
    <div className="mt-10">
      <CatalogToolbar
        action={PATH}
        params={params}
        resultCount={listing.total}
        sortChoices={SEARCH_SORTS}
        defaultSort="relevans"
      />
      <ProductListing
        headingLabel="Sökresultat"
        products={listing.cards}
        page={listing.page}
        pageCount={listing.pageCount}
        hrefForPage={(page) =>
          listingHref(PATH, { ...params, page }, "relevans")
        }
        emptyTitle={`Inga träffar för ”${params.query}”`}
        emptyContent="Kontrollera stavningen eller sök på något mer allmänt, till exempel ett set eller en produkttyp."
        emptyAction={
          <ButtonLink href="/pokemon-tcg" variant="secondary">
            Se hela sortimentet
          </ButtonLink>
        }
      />
    </div>
  );
}

async function EmptySearch({ hasQuery }: { hasQuery: boolean }) {
  const categories = await listCategories(db, new Date());
  return (
    <div className="mt-10 space-y-12">
      <EmptyState
        title={hasQuery ? "Skriv minst två tecken" : "Vad letar du efter?"}
      >
        Sök på produktnamn, set eller produkttyp, till exempel ”booster box”.
      </EmptyState>
      <section aria-labelledby="sok-kategorier">
        <h2 id="sok-kategorier" className="mb-4 type-eyebrow">
          Eller bläddra bland kategorier
        </h2>
        <CategoryTiles categories={categories} />
      </section>
    </div>
  );
}

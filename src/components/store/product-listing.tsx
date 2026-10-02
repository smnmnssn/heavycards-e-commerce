import type { ReactNode } from "react";

import { EmptyState } from "./empty-state";
import { Pagination } from "./pagination";
import { ProductCard, ProductGrid, type ProductCardData } from "./product-card";

/** Cards in view on load (mobile and desktop) load their images eagerly. */
const EAGER_CARDS = 4;

/**
 * Product grid with pagination and an empty state. Purely presentational:
 * pages load and map the data.
 */
export function ProductListing({
  products,
  page,
  pageCount,
  hrefForPage,
  emptyTitle,
  emptyContent,
  emptyAction,
  headingLabel = "Produkter",
}: {
  products: readonly ProductCardData[];
  page: number;
  pageCount: number;
  hrefForPage: (page: number) => string;
  emptyTitle: string;
  emptyContent?: ReactNode;
  emptyAction?: ReactNode;
  /** Visually hidden heading keeping the page outline h1 → h2 → h3. */
  headingLabel?: string;
}) {
  return (
    <section className="mt-8 sm:mt-10">
      <h2 className="sr-only">{headingLabel}</h2>
      {products.length === 0 ? (
        <EmptyState title={emptyTitle} action={emptyAction}>
          {emptyContent}
        </EmptyState>
      ) : (
        <ProductGrid>
          {products.map((product, index) => (
            <ProductCard
              key={product.href}
              product={product}
              eager={page === 1 && index < EAGER_CARDS}
            />
          ))}
        </ProductGrid>
      )}
      <Pagination page={page} pageCount={pageCount} hrefForPage={hrefForPage} />
    </section>
  );
}

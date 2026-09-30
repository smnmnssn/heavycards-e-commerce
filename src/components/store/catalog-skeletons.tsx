import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";

import { ProductCardSkeleton, ProductGrid } from "./product-card";

/** Shown while a listing page loads; mirrors its layout to avoid shifts. */
export function ListingSkeleton() {
  return (
    <Container className="py-10 sm:py-14" aria-busy="true">
      <p className="sr-only" role="status">
        Laddar produkter…
      </p>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-10 h-3 w-24" />
      <Skeleton className="mt-4 h-12 w-2/3 max-w-lg" />
      <Skeleton className="mt-12 h-24 w-full" />
      <ProductGrid className="mt-10">
        {Array.from({ length: 8 }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </ProductGrid>
    </Container>
  );
}

/** Shown while a product page loads. */
export function ProductPageSkeleton() {
  return (
    <Container className="py-8 sm:py-12" aria-busy="true">
      <p className="sr-only" role="status">
        Laddar produkt…
      </p>
      <Skeleton className="h-4 w-64" />
      <div className="mt-6 grid gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
        <Skeleton className="aspect-square rounded-none" />
        <div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-10 w-4/5" />
          <Skeleton className="mt-6 h-8 w-32" />
          <Skeleton className="mt-8 h-13 w-full" />
        </div>
      </div>
    </Container>
  );
}

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ImagePlaceholder } from "./image-placeholder";
import { Price } from "./price";

export type ProductCardBadge = Readonly<{
  label: string;
  variant?: BadgeVariant;
}>;

export type ProductCardData = Readonly<{
  href: string;
  name: string;
  /** Secondary line, e.g. the Pokémon set name. */
  subtitle?: string | null;
  priceAmount: number;
  compareAtPriceAmount?: number | null;
  image?: Readonly<{
    src: string;
    alt: string;
    width: number;
    height: number;
  }> | null;
  /** Derived states such as "Slutsåld" or "Förbeställ", computed by the caller. */
  badges?: readonly ProductCardBadge[];
  /** Dims the image for products that cannot be bought right now. */
  unavailable?: boolean;
  /** Small secondary line under the price, e.g. a release date. */
  note?: string | null;
}>;

/**
 * Product tile (visual shell). Purely presentational: it never decides stock
 * or purchasability itself. `toProductCardData` derives badges, notes and
 * `unavailable` from server-side catalog data.
 *
 * The whole card is one link, so the tap target is large on mobile; the name
 * is the link text, which keeps screen reader output short.
 */
export function ProductCard({
  product,
  eager = false,
  className,
}: {
  product: ProductCardData;
  /**
   * Load the image right away instead of lazily: for the first cards of a
   * listing, which are in view on load. Not a preload: several cards are
   * candidates and none is reliably the LCP element on every viewport.
   */
  eager?: boolean;
  className?: string;
}) {
  const { image, badges = [], unavailable = false } = product;

  return (
    <article className={cn("group relative flex flex-col", className)}>
      <div className="relative aspect-square overflow-hidden bg-surface">
        {image ? (
          <Image
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            loading={eager ? "eager" : "lazy"}
            sizes="(min-width: 80rem) 22vw, (min-width: 48rem) 30vw, 46vw"
            className={cn(
              "size-full object-contain p-[8%] transition-transform duration-500 ease-(--ease-out-soft) motion-safe:group-hover:scale-[1.03]",
              unavailable && "opacity-50",
            )}
          />
        ) : (
          <ImagePlaceholder />
        )}
        {badges.length > 0 && (
          <ul className="absolute top-2 left-2 flex flex-wrap gap-1 sm:top-3 sm:left-3">
            {badges.map((badge) => (
              <li key={badge.label}>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 pt-3 sm:pt-4">
        {product.subtitle && (
          <p className="type-eyebrow text-[0.6875rem] text-muted-foreground">
            {product.subtitle}
          </p>
        )}
        <h3 className="text-sm leading-snug font-semibold sm:text-base">
          <Link
            href={product.href}
            className="underline-offset-4 group-hover:underline after:absolute after:inset-0"
          >
            {product.name}
          </Link>
        </h3>
        <Price
          amount={product.priceAmount}
          compareAtAmount={product.compareAtPriceAmount}
          className="mt-auto pt-1 text-sm sm:text-base"
        />
        {product.note && (
          <p className="text-xs text-muted-foreground sm:text-sm">
            {product.note}
          </p>
        )}
      </div>
    </article>
  );
}

/** Loading placeholder with the same footprint as ProductCard (no layout shift). */
export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="aspect-square rounded-none" />
      <Skeleton className="mt-4 h-3 w-1/3" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <Skeleton className="mt-3 h-4 w-1/4" />
    </div>
  );
}

/** Responsive product grid: 2 columns on phones up to 4 on desktop. */
export function ProductGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 md:grid-cols-3 xl:grid-cols-4 xl:gap-x-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

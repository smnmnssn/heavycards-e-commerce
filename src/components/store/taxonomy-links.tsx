import Link from "next/link";

import { ArrowRightIcon } from "@/components/ui/icons";
import { formatIsoDate } from "@/lib/dates";
import type { SetLink, TaxonomyLink } from "@/server/data/catalog-queries";

const countLabel = (count: number) =>
  count === 1 ? "1 produkt" : `${count} produkter`;

/** Category tiles (homepage, landing pages). Only categories with products. */
export function CategoryTiles({
  categories,
}: {
  categories: readonly TaxonomyLink[];
}) {
  const visible = categories.filter((category) => category.productCount > 0);
  if (visible.length === 0) return null;

  return (
    <ul className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
      {visible.map((category) => (
        <li key={category.slug} className="bg-background">
          <Link
            href={`/kategori/${category.slug}`}
            className="group flex h-full min-h-32 flex-col justify-between gap-6 p-4 transition-colors hover:bg-surface sm:min-h-40 sm:p-5"
          >
            <span className="text-base leading-tight font-bold tracking-[0.02em] uppercase [font-stretch:112%] sm:text-lg">
              {category.name}
            </span>
            <span className="flex items-center justify-between text-sm text-muted-foreground">
              {countLabel(category.productCount)}
              <ArrowRightIcon className="size-4 text-foreground transition-transform duration-200 group-hover:translate-x-1" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Pokémon set list with release dates. Only sets with products. */
export function SetList({ sets }: { sets: readonly SetLink[] }) {
  const visible = sets.filter((set) => set.productCount > 0);
  if (visible.length === 0) return null;

  return (
    <ul className="divide-y divide-border border-y border-border">
      {visible.map((set) => (
        <li key={set.slug}>
          <Link
            href={`/set/${set.slug}`}
            className="group flex min-h-16 items-center justify-between gap-4 py-3 transition-colors hover:bg-surface sm:px-3"
          >
            <span>
              <span className="block font-semibold">{set.name}</span>
              {set.releaseDate && (
                <span className="text-sm text-muted-foreground">
                  {formatIsoDate(set.releaseDate)}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
              {countLabel(set.productCount)}
              <ArrowRightIcon className="size-4 text-foreground transition-transform duration-200 group-hover:translate-x-1" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

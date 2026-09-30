import Link from "next/link";
import { useId } from "react";

import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SORT,
  IN_STOCK_PARAM,
  LISTING_SORTS,
  hasFilterOrSort,
  listingHref,
  sortLabels,
  type ListingParams,
  type SortParam,
} from "@/server/domain/catalog-params";

type Option = { value: string; label: string };

/**
 * Filter and sort controls as a plain GET form: results are server-rendered
 * and every combination is a shareable URL. Changing a select does not
 * navigate by itself (WCAG 3.2.2); the "Visa" button applies the choices.
 */
export function CatalogToolbar({
  action,
  params,
  categories,
  sets,
  resultCount,
  sortChoices = LISTING_SORTS,
  defaultSort = DEFAULT_SORT,
}: {
  /** Path the form submits to (the current listing). */
  action: string;
  params: ListingParams;
  /** Omit to hide the category filter (e.g. on a category page). */
  categories?: readonly Option[];
  sets?: readonly Option[];
  resultCount: number;
  sortChoices?: readonly SortParam[];
  /** The sort applied when none is chosen (relevance on search). */
  defaultSort?: SortParam;
}) {
  const id = useId();
  const hasFilters = hasFilterOrSort(params, defaultSort);

  return (
    <form
      action={action}
      method="get"
      aria-label="Filtrera och sortera"
      className="border-y border-border py-5"
    >
      {params.query && <input type="hidden" name="q" value={params.query} />}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:flex lg:items-end">
        {categories && (
          <Select
            id={`${id}-kategori`}
            name="kategori"
            label="Kategori"
            value={params.categorySlug}
            emptyLabel="Alla kategorier"
            options={categories}
          />
        )}
        {sets && (
          <Select
            id={`${id}-set`}
            name="set"
            label="Set"
            value={params.setSlug}
            emptyLabel="Alla set"
            options={sets}
          />
        )}
        <Select
          id={`${id}-tillganglighet`}
          name="tillganglighet"
          label="Tillgänglighet"
          value={params.inStockOnly ? IN_STOCK_PARAM : undefined}
          emptyLabel="Alla produkter"
          options={[{ value: IN_STOCK_PARAM, label: "Endast i lager" }]}
        />
        <Select
          id={`${id}-sortering`}
          name="sortering"
          label="Sortera"
          value={params.sort ?? defaultSort}
          options={sortChoices.map((value) => ({
            value,
            label: sortLabels[value],
          }))}
        />
        <button
          type="submit"
          className={cn(
            buttonClasses({ size: "md", fullWidth: true }),
            "col-span-2 lg:w-auto",
          )}
        >
          Visa
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {resultCount === 1 ? "1 produkt" : `${resultCount} produkter`}
        </p>
        {hasFilters && (
          <Link
            href={listingHref(action, { query: params.query }, defaultSort)}
            className="font-semibold underline underline-offset-4"
          >
            Rensa filter
          </Link>
        )}
      </div>
    </form>
  );
}

function Select({
  id,
  name,
  label,
  value,
  emptyLabel,
  options,
}: {
  id: string;
  name: string;
  label: string;
  value: string | undefined;
  emptyLabel?: string;
  options: readonly Option[];
}) {
  return (
    <div className="grid gap-1.5 lg:min-w-44">
      <label
        htmlFor={id}
        className="text-xs font-semibold tracking-wide uppercase"
      >
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value ?? ""}
        className="h-11 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-base text-foreground hover:border-foreground focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-0 lg:h-10 lg:text-sm"
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

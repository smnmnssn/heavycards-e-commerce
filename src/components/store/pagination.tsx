import Link from "next/link";

import { ArrowRightIcon } from "@/components/ui/icons";

/**
 * Previous/next pagination with plain links (crawlable, works without
 * JavaScript). `hrefForPage` keeps the current filters and sorting.
 */
export function Pagination({
  page,
  pageCount,
  hrefForPage,
}: {
  page: number;
  pageCount: number;
  hrefForPage: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  const linkClass =
    "type-nav inline-flex min-h-11 items-center gap-2 border border-foreground px-5 transition-colors hover:bg-foreground hover:text-background";

  return (
    <nav
      aria-label="Sidnavigering"
      className="mt-14 flex items-center justify-between gap-4 border-t border-border pt-8"
    >
      {page > 1 ? (
        <Link href={hrefForPage(page - 1)} rel="prev" className={linkClass}>
          <ArrowRightIcon className="size-4 rotate-180" />
          Föregående
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted-foreground">
        Sida {page} av {pageCount}
      </p>
      {page < pageCount ? (
        <Link href={hrefForPage(page + 1)} rel="next" className={linkClass}>
          Nästa
          <ArrowRightIcon className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

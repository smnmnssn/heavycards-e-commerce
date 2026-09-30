import Link from "next/link";

import { ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = Readonly<{
  label: string;
  /** Omit for the current page (always the last item). */
  href?: string;
}>;

/**
 * Visible breadcrumbs (PROJECT.md §66). On narrow screens long trails wrap
 * rather than truncate, so every level stays readable and tappable. JSON-LD
 * BreadcrumbList output is added with the SEO milestone.
 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: readonly BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav aria-label="Brödsmulor" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li
              key={`${item.label}-${index}`}
              className="inline-flex items-center gap-1.5"
            >
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="py-1 underline-offset-4 hover:text-foreground hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(isLast && "font-medium text-foreground")}
                >
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRightIcon className="size-3.5" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

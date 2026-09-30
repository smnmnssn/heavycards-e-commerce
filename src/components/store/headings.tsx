import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** Page title block for inner pages: optional eyebrow, h1 and lead text. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  className,
}: {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("max-w-3xl", className)}>
      {eyebrow && (
        <p className="mb-4 type-eyebrow text-muted-foreground">{eyebrow}</p>
      )}
      <h1 className="type-h1">{title}</h1>
      {lead && (
        <div className="mt-5 type-lead text-muted-foreground">{lead}</div>
      )}
    </header>
  );
}

/** Section title row with an optional "see all" link aligned to the right. */
export function SectionHeading({
  eyebrow,
  title,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 sm:mb-10",
        className,
      )}
    >
      <div>
        {eyebrow && (
          <p className="mb-3 type-eyebrow text-muted-foreground">{eyebrow}</p>
        )}
        <h2 className="type-h2">{title}</h2>
      </div>
      {action && (
        <Link
          href={action.href}
          className="group inline-flex min-h-11 items-center gap-2 type-nav text-foreground"
        >
          {action.label}
          <ArrowRightIcon className="size-4 transition-transform duration-200 ease-(--ease-out-soft) group-hover:translate-x-1" />
        </Link>
      )}
    </div>
  );
}

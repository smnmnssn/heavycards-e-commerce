import Link from "next/link";
import type { ReactNode } from "react";

/** Title block of an admin page, with an optional back link and actions. */
export function AdminPageHeader({
  eyebrow,
  title,
  back,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-4">
      {back && (
        <Link
          href={back.href}
          className="inline-flex min-h-11 w-fit items-center text-sm font-semibold underline-offset-4 hover:underline"
        >
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="type-eyebrow text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-3 type-h1 break-words">{title}</h1>
        </div>
        {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Rendered instead of a page for a signed-in role without catalog access. */
export function CatalogForbidden() {
  return (
    <section
      aria-labelledby="behorighet-saknas"
      className="max-w-2xl rounded-lg border border-border bg-background p-6 sm:p-8"
    >
      <p className="type-eyebrow text-muted-foreground">403</p>
      <h1 id="behorighet-saknas" className="mt-3 type-h2">
        Behörighet saknas
      </h1>
      <p className="mt-4 text-muted-foreground">
        Ditt konto har inte behörighet att hantera katalogen.
      </p>
    </section>
  );
}

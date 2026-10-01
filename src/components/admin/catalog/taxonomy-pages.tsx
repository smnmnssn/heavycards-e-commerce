import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { formatIsoDate, type IsoDate } from "@/lib/dates";

import { FormAlert } from "../form-alert";
import { DangerAction } from "./danger-action";
import { FormSection } from "./form-layout";
import { AdminPageHeader } from "./page-header";

/*
 * Shared layout for the category and Pokémon-set admin pages, which differ
 * only in wording and one field.
 */

export type TaxonomyListRow = {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  sortOrder?: number;
  releaseDate?: IsoDate | null;
};

export function TaxonomyListPage({
  title,
  basePath,
  publicPath,
  newLabel,
  rows,
  deleted,
  emptyText,
  detailColumn,
}: {
  title: string;
  basePath: string;
  publicPath: (slug: string) => string;
  newLabel: string;
  rows: TaxonomyListRow[];
  deleted: boolean;
  emptyText: string;
  detailColumn: "sortOrder" | "releaseDate";
}) {
  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Katalog"
        title={title}
        actions={<ButtonLink href={`${basePath}/new`}>{newLabel}</ButtonLink>}
      >
        {deleted && (
          <FormAlert tone="success">
            Borttagen. Den gamla adressen leder nu till /pokemon-tcg.
          </FormAlert>
        )}
      </AdminPageHeader>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-8 text-center text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="taxonomy-row"
              className="grid gap-2 p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:p-5"
            >
              <div className="min-w-0">
                <Link
                  href={`${basePath}/${row.id}`}
                  className="font-semibold break-words underline-offset-4 hover:underline"
                >
                  {row.name}
                </Link>
                <p className="truncate text-sm text-muted-foreground">
                  {publicPath(row.slug)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {detailColumn === "sortOrder"
                  ? `Sorteringsordning ${row.sortOrder}`
                  : row.releaseDate
                    ? `Släpps/släpptes ${formatIsoDate(row.releaseDate)}`
                    : "Inget släppdatum"}
              </p>
              <p className="text-sm sm:text-right">
                {row.productCount}{" "}
                {row.productCount === 1 ? "produkt" : "produkter"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Delete section: only offered while nothing references the record. */
export function TaxonomyDeleteSection({
  noun,
  name,
  productCount,
  productsHref,
  publicUrl,
  deleteAction,
}: {
  noun: "kategorin" | "setet";
  name: string;
  productCount: number;
  productsHref: string;
  publicUrl: string;
  deleteAction: () => Promise<{ status: string; message?: string }>;
}) {
  return (
    <FormSection id="ta-bort" title="Ta bort">
      {productCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {noun === "kategorin" ? "Kategorin" : "Setet"} används av{" "}
          <Link
            href={productsHref}
            className="font-semibold text-foreground underline underline-offset-4"
          >
            {productCount} {productCount === 1 ? "produkt" : "produkter"}
          </Link>{" "}
          (även utkast och arkiverade räknas) och kan därför inte tas bort.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Inga produkter använder {noun}. Om du tar bort den leder adressen{" "}
            <code className="break-all">{publicUrl}</code> permanent till
            /pokemon-tcg.
          </p>
          <DangerAction
            action={deleteAction}
            label={`Ta bort ${noun}`}
            pendingLabel="Tar bort…"
            confirmMessage={`Ta bort ${name}? Det går inte att ångra.`}
          />
        </>
      )}
    </FormSection>
  );
}

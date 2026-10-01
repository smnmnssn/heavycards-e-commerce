import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminPageHeader,
  CatalogForbidden,
} from "@/components/admin/catalog/page-header";
import { TaxonomyForm } from "@/components/admin/catalog/taxonomy-form";
import { TaxonomyDeleteSection } from "@/components/admin/catalog/taxonomy-pages";
import { FormAlert } from "@/components/admin/form-alert";
import { ButtonLink } from "@/components/ui/button";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { setPath } from "@/lib/catalog-paths";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { pokemonSetFormValues } from "@/server/admin/catalog/form-values";
import { getAdminSet } from "@/server/admin/catalog/queries";
import { UUID_PATTERN } from "@/server/admin/catalog/shared";

import { deletePokemonSetAction } from "../actions";

export const metadata: Metadata = { title: "Redigera Pokémon-set" };

export default async function EditSetPage({
  params,
  searchParams,
}: PageProps<"/admin/sets/[id]">) {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [set, query] = await Promise.all([getAdminSet(db, id), searchParams]);
  if (!set) notFound();

  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Pokémon-set"
        title={set.name}
        back={{ href: "/admin/sets", label: "Alla set" }}
        actions={
          <ButtonLink
            href={setPath(set.slug)}
            variant="secondary"
            target="_blank"
          >
            Visa i butiken
          </ButtonLink>
        }
      >
        {query.skapad === "1" && (
          <FormAlert tone="success">Setet är skapat.</FormAlert>
        )}
      </AdminPageHeader>
      <TaxonomyForm
        kind="set"
        id={set.id}
        initialValues={pokemonSetFormValues(set)}
        siteUrl={env.siteUrl}
      />
      <TaxonomyDeleteSection
        noun="setet"
        name={set.name}
        productCount={set.productCount}
        productsHref={`/admin/products?status=alla&set=${set.id}`}
        publicUrl={setPath(set.slug)}
        deleteAction={deletePokemonSetAction.bind(null, set.id)}
      />
    </div>
  );
}

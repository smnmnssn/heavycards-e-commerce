import type { Metadata } from "next";

import {
  AdminPageHeader,
  CatalogForbidden,
} from "@/components/admin/catalog/page-header";
import { TaxonomyForm } from "@/components/admin/catalog/taxonomy-form";
import { canManageCatalog } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { env } from "@/lib/env/server";
import { EMPTY_SET_FORM } from "@/server/admin/catalog/form-values";

export const metadata: Metadata = { title: "Nytt Pokémon-set" };

export default async function NewSetPage() {
  const admin = await requireAdmin();
  if (!canManageCatalog(admin)) return <CatalogForbidden />;

  return (
    <div className="grid gap-8">
      <AdminPageHeader
        eyebrow="Katalog"
        title="Nytt Pokémon-set"
        back={{ href: "/admin/sets", label: "Alla set" }}
      />
      <TaxonomyForm
        kind="set"
        initialValues={EMPTY_SET_FORM}
        siteUrl={env.siteUrl}
      />
    </div>
  );
}

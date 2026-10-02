import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminPageHeader } from "@/components/admin/catalog/page-header";
import { StoreSettingsForm } from "@/components/admin/settings/store-settings-form";
import { canManageStoreSettings } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { formatSek } from "@/lib/money";
import {
  SHIPPING_CARRIER_OPTIONS,
  storeSettingsFormValues,
  type StoreSettingsData,
} from "@/lib/validation/store-settings";
import { getStoreSettingsForAdmin } from "@/server/admin/settings/store-settings";

export const metadata: Metadata = { title: "Inställningar" };

export default async function AdminSettingsPage() {
  const admin = await requireAdmin();
  const settings = await getStoreSettingsForAdmin(db, { actorId: admin.id });
  const editable = canManageStoreSettings(admin);

  return (
    <div className="grid gap-8">
      <AdminPageHeader eyebrow="Butik" title="Inställningar">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Butikens affärsregler: kontaktuppgifter, frakt, moms, lagergräns och
          startsidans sökmotortexter.
          {!editable && " Endast ägare (OWNER) kan ändra dem."}
        </p>
      </AdminPageHeader>

      {editable ? (
        <StoreSettingsForm
          initialValues={storeSettingsFormValues(settings)}
          configured={settings !== null}
        />
      ) : (
        <SettingsSummary settings={settings} />
      )}

      <section
        aria-labelledby="tekniska-installningar"
        className="rounded-lg border border-border bg-muted p-5 text-sm sm:p-6"
      >
        <h2 id="tekniska-installningar" className="font-semibold">
          Tekniska inställningar finns inte här
        </h2>
        <p className="mt-2 text-muted-foreground">
          Betalnings- och e-postnycklar (Stripe, Resend), avsändaradress,
          inloggningshemligheter, databas och schemalagda jobb är
          driftskonfiguration. De sätts som miljövariabler hos Vercel av den som
          driftar butiken och visas aldrig i admin.
        </p>
      </section>
    </div>
  );
}

function SettingsSummary({ settings }: { settings: StoreSettingsData | null }) {
  if (!settings) {
    return (
      <p className="rounded-lg border border-border bg-background p-6 text-muted-foreground">
        Butiken har inga inställningar ännu. En ägare behöver spara dem innan
        kassan kan användas.
      </p>
    );
  }
  const rows: Array<[string, ReactNode]> = [
    ["Butiksnamn", settings.storeName],
    ["Kundtjänstens e-post", settings.contactEmail],
    ["Företagsnamn", settings.companyName],
    ["Organisationsnummer", settings.organizationNumber],
    ["Fraktpris", formatSek(settings.shippingPriceAmount)],
    [
      "Fri frakt från",
      settings.freeShippingThresholdAmount === null
        ? "Ingen fri frakt"
        : formatSek(settings.freeShippingThresholdAmount),
    ],
    ["Fraktbolag", SHIPPING_CARRIER_OPTIONS[settings.defaultShippingCarrier]],
    ["Momssats", `${settings.vatRateBasisPoints / 100} %`],
    ["Gräns för lågt lager", `${settings.lowStockThreshold} st`],
    ["SEO-titel (startsidan)", settings.defaultSeoTitle],
    ["Metabeskrivning (startsidan)", settings.defaultSeoDescription],
  ];
  return (
    <dl
      data-testid="settings-summary"
      className="grid gap-x-6 gap-y-3 rounded-lg border border-border bg-background p-5 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:p-6"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { ROLE_LABELS } from "@/components/admin/roles";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Översikt" };

const stockholmTime = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

const catalogLinks = [
  {
    href: "/admin/products",
    label: "Produkter",
    text: "Pris, lager, publicering och bilder",
  },
  {
    href: "/admin/categories",
    label: "Kategorier",
    text: "Kategorisidor och ordning",
  },
  {
    href: "/admin/sets",
    label: "Pokémon-set",
    text: "Setsidor och släppdatum",
  },
];

const upcoming = [
  "Ordrar och leveranser",
  "Recensioner",
  "Butiksinställningar",
];

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();

  return (
    <div className="grid gap-10">
      <div>
        <p className="type-eyebrow text-muted-foreground">Översikt</p>
        <h1 className="mt-3 type-h1">Hej {admin.name}</h1>
        <p className="mt-4 max-w-2xl type-lead text-muted-foreground">
          Du är inloggad som {ROLE_LABELS[admin.role].toLowerCase()}. Sessionen
          gäller till {stockholmTime.format(admin.sessionExpiresAt)}.
        </p>
      </div>

      <section aria-labelledby="katalog">
        <h2 id="katalog" className="type-h3">
          Katalog
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {catalogLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="block h-full rounded-lg border border-border bg-background p-5 transition-colors hover:border-foreground"
              >
                <span className="font-semibold">{link.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {link.text}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="kommande-funktioner"
        className="rounded-lg border border-border bg-background p-6 sm:p-8"
      >
        <h2 id="kommande-funktioner" className="type-h3">
          Kommer snart
        </h2>
        <p className="mt-2 text-muted-foreground">
          Adminpanelen byggs ut steg för steg. Följande delar tillkommer:
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {upcoming.map((item) => (
            <li key={item} className="rounded-md bg-muted px-4 py-3 text-sm">
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

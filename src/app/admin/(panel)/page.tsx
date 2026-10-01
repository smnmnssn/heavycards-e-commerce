import type { Metadata } from "next";

import { ROLE_LABELS } from "@/components/admin/roles";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Översikt" };

const stockholmTime = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

const upcoming = [
  "Produkter, kategorier och set",
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

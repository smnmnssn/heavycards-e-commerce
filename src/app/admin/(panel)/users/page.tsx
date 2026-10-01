import type { Metadata } from "next";

import { AdminRowAction } from "@/components/admin/admin-row-action";
import { InviteAdminForm } from "@/components/admin/invite-admin-form";
import { ROLE_LABELS } from "@/components/admin/roles";
import { Badge } from "@/components/ui/badge";
import { isOwner } from "@/lib/auth/authorization";
import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { listAdmins } from "@/server/admin/admin-users";
import { listOpenInvitations } from "@/server/admin/invitations";

import { revokeInvitationAction, setAdminActiveAction } from "./actions";

export const metadata: Metadata = { title: "Administratörer" };

const stockholmDateTime = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

export default async function AdminUsersPage() {
  const admin = await requireAdmin();

  // OWNER only. Nothing is loaded for an ADMIN, and every action below
  // re-checks the role on the server.
  if (!isOwner(admin)) {
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
          Endast ägare (OWNER) kan hantera administratörer.
        </p>
      </section>
    );
  }

  const now = new Date();
  const [admins, invitations] = await Promise.all([
    listAdmins(db),
    listOpenInvitations(db),
  ]);

  return (
    <div className="grid gap-12">
      <div>
        <p className="type-eyebrow text-muted-foreground">Ägare</p>
        <h1 className="mt-3 type-h1">Administratörer</h1>
      </div>

      <section aria-labelledby="administratorer-lista">
        <h2 id="administratorer-lista" className="type-h3">
          Konton
        </h2>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-background">
          {admins.map((row) => (
            <li
              key={row.id}
              data-testid="admin-row"
              className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {row.name}
                  {row.id === admin.id && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      (du)
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {row.email}
                </p>
                <p className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">{ROLE_LABELS[row.role]}</Badge>
                  <Badge variant={row.isActive ? "solid" : "muted"}>
                    {row.isActive ? "Aktiv" : "Inaktiv"}
                  </Badge>
                </p>
              </div>
              {row.id !== admin.id && (
                <AdminRowAction
                  action={setAdminActiveAction}
                  fields={{
                    adminUserId: row.id,
                    active: row.isActive ? "false" : "true",
                  }}
                  label={row.isActive ? "Inaktivera" : "Aktivera"}
                  pendingLabel="Sparar…"
                  accessibleLabel={`${row.isActive ? "Inaktivera" : "Aktivera"} ${row.name}`}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="bjud-in"
        className="rounded-lg border border-border bg-background p-6 sm:p-8"
      >
        <h2 id="bjud-in" className="type-h3">
          Bjud in administratör
        </h2>
        <div className="mt-6">
          <InviteAdminForm />
        </div>
      </section>

      <section aria-labelledby="inbjudningar">
        <h2 id="inbjudningar" className="type-h3">
          Väntande inbjudningar
        </h2>
        {invitations.length === 0 ? (
          <p className="mt-4 text-muted-foreground">
            Inga väntande inbjudningar.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-background">
            {invitations.map((invitation) => {
              const expired = invitation.expiresAt <= now;
              return (
                <li
                  key={invitation.id}
                  data-testid="invitation-row"
                  className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{invitation.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {invitation.email}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {expired ? "Gick ut" : "Gäller till"}{" "}
                      {stockholmDateTime.format(invitation.expiresAt)} ·
                      inbjuden av {invitation.invitedBy.name}
                    </p>
                  </div>
                  <AdminRowAction
                    action={revokeInvitationAction}
                    fields={{ invitationId: invitation.id }}
                    label="Återkalla"
                    pendingLabel="Återkallar…"
                    accessibleLabel={`Återkalla inbjudan till ${invitation.email}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

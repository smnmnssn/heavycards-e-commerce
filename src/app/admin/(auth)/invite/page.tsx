import type { Metadata } from "next";

import { AcceptInviteForm } from "@/components/admin/accept-invite-form";
import { AuthCard } from "@/components/admin/auth-card";
import { InvalidLinkNotice } from "@/components/admin/invalid-link-notice";
import { ADMIN_LOGIN_PATH } from "@/lib/auth/routes";
import { db } from "@/lib/db/client";
import { findUsableInvitation } from "@/server/admin/invitations";

export const metadata: Metadata = { title: "Aktivera administratörskonto" };

export default async function AcceptInvitePage({
  searchParams,
}: PageProps<"/admin/invite">) {
  const { token } = await searchParams;
  const invitation = await findUsableInvitation(db, token);

  if (!invitation || typeof token !== "string") {
    return (
      <InvalidLinkNotice
        title="Inbjudan kan inte användas"
        text="Inbjudan är ogiltig, har redan använts eller har gått ut. Be en ägare att skicka en ny inbjudan."
        action={{ label: "Till inloggningen", href: ADMIN_LOGIN_PATH }}
      />
    );
  }

  return (
    <AuthCard
      title="Aktivera ditt konto"
      description={
        <p>
          Välkommen, {invitation.name}! Välj ett lösenord för{" "}
          <strong className="font-semibold text-foreground">
            {invitation.email}
          </strong>
          .
        </p>
      }
    >
      <AcceptInviteForm token={token} email={invitation.email} />
    </AuthCard>
  );
}

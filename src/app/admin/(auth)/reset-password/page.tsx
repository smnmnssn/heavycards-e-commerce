import type { Metadata } from "next";

import { AuthCard } from "@/components/admin/auth-card";
import { InvalidLinkNotice } from "@/components/admin/invalid-link-notice";
import { ResetPasswordForm } from "@/components/admin/reset-password-form";
import { ADMIN_FORGOT_PASSWORD_PATH } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Välj nytt lösenord" };

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/admin/reset-password">) {
  const { token } = await searchParams;

  // The token is checked when the form is submitted (Better Auth consumes it
  // atomically); here it only needs to be present.
  if (typeof token !== "string" || token.length === 0 || token.length > 256) {
    return (
      <InvalidLinkNotice
        title="Ogiltig länk"
        text="Länken för att återställa lösenordet är ogiltig eller ofullständig."
        action={{ label: "Begär en ny länk", href: ADMIN_FORGOT_PASSWORD_PATH }}
      />
    );
  }

  return (
    <AuthCard
      title="Välj nytt lösenord"
      description="När lösenordet är bytt loggas alla dina sessioner ut."
    >
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/admin/auth-card";
import { FormAlert } from "@/components/admin/form-alert";
import { LoginForm } from "@/components/admin/login-form";
import { safeAdminRedirect } from "@/lib/auth/routes";
import { getCurrentAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Logga in" };

const NOTICES: Record<string, string> = {
  "signed-out": "Du är utloggad.",
  "password-reset": "Lösenordet är bytt. Logga in med det nya lösenordet.",
  activated: "Kontot är aktiverat. Logga in med ditt nya lösenord.",
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function AdminLoginPage({
  searchParams,
}: PageProps<"/admin/login">) {
  const params = await searchParams;
  const next = safeAdminRedirect(first(params.next));

  // A valid session never stays on the login page.
  if (await getCurrentAdmin()) redirect(next);

  const notice = NOTICES[first(params.notice) ?? ""];

  return (
    <AuthCard
      title="Logga in"
      description="Administration av HeavyCards. Endast för behöriga."
    >
      {notice && (
        <FormAlert tone="success" className="mb-6">
          {notice}
        </FormAlert>
      )}
      <LoginForm next={next} />
    </AuthCard>
  );
}

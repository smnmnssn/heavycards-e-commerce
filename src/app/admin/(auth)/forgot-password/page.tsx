import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/admin/auth-card";
import { ForgotPasswordForm } from "@/components/admin/forgot-password-form";
import { ADMIN_LOGIN_PATH } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Glömt lösenord" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Glömt lösenord"
      description="Ange e-postadressen till ditt administratörskonto så skickar vi en länk för att välja ett nytt lösenord."
    >
      <ForgotPasswordForm />
      <p className="mt-6 text-sm">
        <Link
          href={ADMIN_LOGIN_PATH}
          className="font-semibold underline decoration-1 underline-offset-4 hover:decoration-2"
        >
          Tillbaka till inloggningen
        </Link>
      </p>
    </AuthCard>
  );
}

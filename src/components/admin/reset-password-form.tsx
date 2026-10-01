"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { getAuthClient } from "@/lib/auth/client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import {
  ADMIN_FORGOT_PASSWORD_PATH,
  ADMIN_LOGIN_PATH,
} from "@/lib/auth/routes";

import { FormAlert } from "./form-alert";
import { NewPasswordFields } from "./new-password-fields";

type FormError = {
  message: string;
  field?: "password" | "confirmPassword";
  invalidToken?: boolean;
};

/** Sets a new password with the single-use token from the emailed link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError({
        field: "password",
        message: `Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`,
      });
      return;
    }
    if (password !== form.get("confirmPassword")) {
      setError({
        field: "confirmPassword",
        message: "Lösenorden matchar inte.",
      });
      return;
    }

    setPending(true);
    setError(null);
    try {
      const { error: resetError } = await getAuthClient().resetPassword({
        newPassword: password,
        token,
      });
      if (resetError) {
        setError(
          resetError.status === 429
            ? { message: "För många försök. Vänta en stund och försök igen." }
            : resetError.code === "PASSWORD_TOO_SHORT" ||
                resetError.code === "PASSWORD_TOO_LONG"
              ? { field: "password", message: "Lösenordets längd är ogiltig." }
              : {
                  invalidToken: true,
                  message:
                    "Länken är ogiltig, har redan använts eller har gått ut.",
                },
        );
        setPending(false);
        return;
      }
      router.replace(`${ADMIN_LOGIN_PATH}?notice=password-reset`);
    } catch {
      setError({ message: "Något gick fel. Försök igen om en stund." });
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6" aria-busy={pending}>
      {error && !error.field && (
        <FormAlert tone="error">
          {error.message}
          {error.invalidToken && (
            <>
              {" "}
              <Link
                href={ADMIN_FORGOT_PASSWORD_PATH}
                className="underline underline-offset-4"
              >
                Begär en ny länk
              </Link>
              .
            </>
          )}
        </FormAlert>
      )}
      <NewPasswordFields error={error?.message} errorField={error?.field} />
      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "Sparar…" : "Spara nytt lösenord"}
      </Button>
    </form>
  );
}

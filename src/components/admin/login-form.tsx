"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { getAuthClient } from "@/lib/auth/client";
import { ADMIN_FORGOT_PASSWORD_PATH } from "@/lib/auth/routes";

import { FormAlert } from "./form-alert";

/** One message for every credential failure, so no account is revealed. */
export const INVALID_CREDENTIALS_MESSAGE =
  "E-postadress eller lösenord är felaktigt.";
const RATE_LIMITED_MESSAGE =
  "För många inloggningsförsök. Vänta några minuter och försök igen.";
const UNAVAILABLE_MESSAGE =
  "Inloggningen kunde inte genomföras just nu. Försök igen om en stund.";

/**
 * Signs in through Better Auth's HTTP endpoint (rate limited, origin
 * checked). `next` has already been validated on the server.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    try {
      const { error: signInError } = await getAuthClient().signIn.email({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (signInError) {
        setError(
          signInError.status === 429
            ? RATE_LIMITED_MESSAGE
            : signInError.status >= 500
              ? UNAVAILABLE_MESSAGE
              : INVALID_CREDENTIALS_MESSAGE,
        );
        setPending(false);
        passwordRef.current?.select();
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError(UNAVAILABLE_MESSAGE);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6" aria-busy={pending}>
      {error && <FormAlert tone="error">{error}</FormAlert>}

      <div className="grid gap-2">
        <Label htmlFor="login-email">E-postadress</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <Label htmlFor="login-password">Lösenord</Label>
          <Link
            href={ADMIN_FORGOT_PASSWORD_PATH}
            className="text-sm font-semibold underline decoration-1 underline-offset-4 hover:decoration-2"
          >
            Glömt lösenordet?
          </Link>
        </div>
        <Input
          ref={passwordRef}
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "Loggar in…" : "Logga in"}
      </Button>
    </form>
  );
}

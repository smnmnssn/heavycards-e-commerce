"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { getAuthClient } from "@/lib/auth/client";

import { FormAlert } from "./form-alert";

/**
 * Requests a reset link. The confirmation is identical whether or not the
 * address belongs to an administrator.
 */
export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<"sent" | "rate-limited" | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setResult(null);
    try {
      const { error } = await getAuthClient().requestPasswordReset({
        email: String(form.get("email") ?? "")
          .trim()
          .toLowerCase(),
      });
      setResult(error?.status === 429 ? "rate-limited" : "sent");
    } catch {
      setResult("sent");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6" aria-busy={pending}>
      {result === "sent" && (
        <FormAlert tone="success">
          Om adressen tillhör ett aktivt administratörskonto har vi skickat en
          länk för att välja ett nytt lösenord. Länken gäller i en timme.
        </FormAlert>
      )}
      {result === "rate-limited" && (
        <FormAlert tone="error">
          För många försök. Vänta en stund och försök igen.
        </FormAlert>
      )}

      <div className="grid gap-2">
        <Label htmlFor="forgot-email">E-postadress</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </div>

      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "Skickar…" : "Skicka återställningslänk"}
      </Button>
    </form>
  );
}

"use client";

import { useActionState } from "react";

import {
  acceptInviteAction,
  type AcceptInviteState,
} from "@/app/admin/(auth)/invite/actions";
import { Button } from "@/components/ui/button";

import { FormAlert } from "./form-alert";
import { NewPasswordFields } from "./new-password-fields";

const initialState: AcceptInviteState = { status: "idle" };

export function AcceptInviteForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(
    acceptInviteAction,
    initialState,
  );
  const error = state.status === "error" ? state : null;

  return (
    <form action={formAction} className="grid gap-6" aria-busy={pending}>
      {error && !error.field && (
        <FormAlert tone="error">{error.message}</FormAlert>
      )}
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers store the new password under the right account. */}
      <input
        type="email"
        name="username"
        value={email}
        autoComplete="username"
        readOnly
        hidden
      />
      <NewPasswordFields error={error?.message} errorField={error?.field} />
      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "Aktiverar…" : "Aktivera kontot"}
      </Button>
    </form>
  );
}

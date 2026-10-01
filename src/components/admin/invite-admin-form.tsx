"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  inviteAdminAction,
  type AdminActionState,
} from "@/app/admin/(panel)/users/actions";
import { Button } from "@/components/ui/button";
import { FieldMessage, Input, Label } from "@/components/ui/form";
import { INVITATION_TTL_HOURS } from "@/lib/auth/policy";

import { FormAlert } from "./form-alert";

const initialState: AdminActionState = { status: "idle" };

/** Invites a new ADMIN. There is no role field: V1 invites ADMIN only. */
export function InviteAdminForm() {
  const [state, formAction, pending] = useActionState(
    inviteAdminAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-5"
      aria-busy={pending}
    >
      {state.status !== "idle" && (
        <FormAlert tone={state.status === "error" ? "error" : "success"}>
          {state.message}
        </FormAlert>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor="invite-name">Namn</Label>
          <Input
            id="invite-name"
            name="name"
            autoComplete="off"
            maxLength={120}
            required
            aria-invalid={fieldErrors?.name ? true : undefined}
            aria-describedby={
              fieldErrors?.name ? "invite-name-error" : undefined
            }
          />
          {fieldErrors?.name && (
            <FieldMessage id="invite-name-error" tone="error">
              {fieldErrors.name}
            </FieldMessage>
          )}
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="invite-email">E-postadress</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={320}
            required
            aria-invalid={fieldErrors?.email ? true : undefined}
            aria-describedby={
              fieldErrors?.email ? "invite-email-error" : undefined
            }
          />
          {fieldErrors?.email && (
            <FieldMessage id="invite-email-error" tone="error">
              {fieldErrors.email}
            </FieldMessage>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Den inbjudna får rollen administratör och en länk som gäller i{" "}
        {INVITATION_TTL_HOURS} timmar.
      </p>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Skickar…" : "Skicka inbjudan"}
        </Button>
      </div>
    </form>
  );
}

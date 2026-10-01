"use client";

import { useActionState } from "react";

import type { AdminActionState } from "@/app/admin/(panel)/users/actions";
import { Button } from "@/components/ui/button";

const initialState: AdminActionState = { status: "idle" };

/**
 * A single-button form for a row action (deactivate, reactivate, revoke).
 * Errors are announced next to the button.
 */
export function AdminRowAction({
  action,
  fields,
  label,
  pendingLabel,
  accessibleLabel,
}: {
  action: (
    state: AdminActionState,
    formData: FormData,
  ) => Promise<AdminActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  accessibleLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        className="h-11"
        disabled={pending}
        aria-label={accessibleLabel}
      >
        {pending ? pendingLabel : label}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}

"use client";

import { useActionState } from "react";

import { Button, type ButtonVariant } from "@/components/ui/button";

type RowActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/**
 * A single-button form for a row action (deactivate, reactivate, revoke,
 * approve, mark handled). Errors are announced next to the button.
 */
export function AdminRowAction<S extends RowActionState>({
  action,
  fields,
  label,
  pendingLabel,
  accessibleLabel,
  variant = "secondary",
}: {
  action: (state: S, formData: FormData) => Promise<S>;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  accessibleLabel: string;
  variant?: ButtonVariant;
}) {
  // Every row action state type includes "idle", so S accepts the start state.
  const [state, formAction, pending] = useActionState(
    action as unknown as (
      state: RowActionState,
      formData: FormData,
    ) => Promise<RowActionState>,
    { status: "idle" },
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant={variant}
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

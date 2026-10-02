"use client";

import { useActionState } from "react";

import { recheckPaymentAction } from "@/app/admin/(panel)/orders/actions";
import { FormAlert } from "@/components/admin/form-alert";
import { Button } from "@/components/ui/button";
import type { AdminFormState } from "@/server/admin/action-guard";

const IDLE: AdminFormState = { status: "idle" };

/**
 * "Kontrollera med Stripe igen": asks Stripe for the checkout's current
 * state and lets the payment service act on it. Stays mounted while the
 * order has a payment problem, so Stripe's answer stays visible after the
 * page refreshes (also when the button itself is no longer offered).
 */
export function RecheckPayment({
  orderId,
  available,
}: {
  orderId: string;
  /** The order is still a pending checkout that Stripe can answer for. */
  available: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    recheckPaymentAction,
    IDLE,
  );
  return (
    <div className="grid gap-3">
      {available && (
        <form action={formAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Kontrollerar…" : "Kontrollera med Stripe igen"}
          </Button>
        </form>
      )}
      {!pending && state.status === "success" && (
        <FormAlert tone="success">{state.message}</FormAlert>
      )}
      {!pending && state.status === "error" && (
        <FormAlert tone="error">{state.message}</FormAlert>
      )}
    </div>
  );
}

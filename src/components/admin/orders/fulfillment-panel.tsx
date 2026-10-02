"use client";

import { useActionState, useState } from "react";

import { transitionFulfillmentAction } from "@/app/admin/(panel)/orders/actions";
import { describedBy, Field } from "@/components/admin/catalog/form-layout";
import { FormAlert } from "@/components/admin/form-alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import type {
  FulfillmentStatus,
  ShippingCarrier,
} from "@/generated/prisma/enums";
import type { AdminFormState } from "@/server/admin/action-guard";
import {
  CARRIER_LABELS,
  FULFILLMENT_ACTION_LABELS,
} from "@/server/admin/orders/presenters";

type Target = Exclude<FulfillmentStatus, "NEW">;

const IDLE: AdminFormState = { status: "idle" };

/**
 * Fulfillment actions for one order. The server decides what is possible
 * (`targets` comes from the domain rules) and re-validates every
 * submission in transitionFulfillment; this only offers the next steps.
 * One action state for all forms, so the result stays visible after the
 * page refreshes into the next status.
 */
export function FulfillmentPanel({
  orderId,
  status,
  targets,
  carrier,
  trackingNumber,
}: {
  orderId: string;
  status: FulfillmentStatus;
  /** Statuses this order may move to now (transition and payment rules). */
  targets: Target[];
  carrier: ShippingCarrier;
  trackingNumber: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    transitionFulfillmentAction,
    IDLE,
  );
  const [confirmCancel, setConfirmCancel] = useState(false);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const shipping = status === "SHIPPED" || targets.includes("SHIPPED");
  const simpleTargets = targets.filter(
    (target) => target !== "SHIPPED" && target !== "CANCELLED",
  );

  return (
    <div className="grid gap-5">
      {shipping && (
        <form
          // Fresh defaults after a save.
          key={`${status}:${trackingNumber ?? ""}:${carrier}`}
          action={formAction}
          className="grid gap-4"
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="to" value="SHIPPED" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="leverans-fraktbolag" label="Fraktbolag">
              <Select
                id="leverans-fraktbolag"
                name="shippingCarrier"
                defaultValue={carrier}
                aria-invalid={fieldErrors?.shippingCarrier ? true : undefined}
              >
                {Object.entries(CARRIER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="leverans-sparning"
              label="Spårningsnummer (valfritt)"
              hint="Visas i leveransbeskedet. Ingen spårningslänk skapas."
              error={fieldErrors?.trackingNumber}
            >
              <Input
                id="leverans-sparning"
                name="trackingNumber"
                defaultValue={trackingNumber ?? ""}
                maxLength={100}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={fieldErrors?.trackingNumber ? true : undefined}
                aria-describedby={describedBy("leverans-sparning", {
                  hint: true,
                  error: Boolean(fieldErrors?.trackingNumber),
                })}
              />
            </Field>
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {status === "SHIPPED"
                ? "Spara spårningsuppgifter"
                : FULFILLMENT_ACTION_LABELS.SHIPPED}
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">
              {status === "SHIPPED"
                ? "Ändrar bara uppgifterna i admin. Kunden får inget nytt mejl."
                : "Kunden får leveransbeskedet med spårningsnummer och recensionslänk en gång."}
            </p>
          </div>
        </form>
      )}

      {simpleTargets.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {simpleTargets.map((target) => (
            <form key={target} action={formAction}>
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="to" value={target} />
              <Button
                type="submit"
                variant={shipping ? "secondary" : "primary"}
                disabled={pending}
              >
                {FULFILLMENT_ACTION_LABELS[target]}
              </Button>
            </form>
          ))}
        </div>
      )}

      {targets.includes("CANCELLED") && (
        <div className="grid gap-3 border-t border-border pt-5">
          {confirmCancel ? (
            <form action={formAction} className="grid gap-3">
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="to" value="CANCELLED" />
              <p className="text-sm">
                Avbryt beställningen? Det går inte att ångra. Pengar återbetalas
                inte automatiskt (gör det i Stripe Dashboard), och lagret ändras
                inte – justera lagersaldot under Produkter om varorna kan säljas
                igen.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant="secondary" disabled={pending}>
                  Ja, avbryt beställningen
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmCancel(false)}
                  disabled={pending}
                >
                  Behåll
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button
                variant="ghost"
                className="h-11 px-0 underline underline-offset-4"
                onClick={() => setConfirmCancel(true)}
              >
                {FULFILLMENT_ACTION_LABELS.CANCELLED}…
              </Button>
            </div>
          )}
        </div>
      )}

      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Sparar…
        </p>
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

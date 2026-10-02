import type { PrismaClient } from "@/generated/prisma/client";
import type { ReviewLinkKey } from "@/server/domain/review-token";
import { transitionFulfillment } from "@/server/orders/fulfillment";

import type { AdminFormState } from "../action-guard";
import { FULFILLMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "./presenters";

/*
 * The admin order page's fulfillment form, translated to the one
 * fulfillment service (src/server/orders/fulfillment.ts, Milestone 10) and
 * back into Swedish feedback. Nothing here decides a transition: allowed
 * moves, the payment precondition, `shippedAt`, the review invitation and
 * the shipping-email obligation all stay in that service.
 */

type FormLike = Pick<FormData, "get">;

export type FulfillmentFormResult = {
  state: AdminFormState;
  /** Email obligations the transition created, to dispatch after the response. */
  emailDeliveryIds: string[];
};

const text = (form: FormLike, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

/**
 * Builds the service input from posted fields. Tracking details are only
 * passed when shipping (or correcting a shipped order), so another
 * transition can never clear them; a blank tracking field means "none".
 */
export function fulfillmentInputFromForm(form: FormLike) {
  const to = text(form, "to");
  const input: Record<string, unknown> = { orderId: text(form, "orderId"), to };
  if (to === "SHIPPED") {
    input.trackingNumber = text(form, "trackingNumber") ?? "";
    input.shippingCarrier = text(form, "shippingCarrier");
  }
  return input;
}

export async function submitFulfillmentForm(
  db: PrismaClient,
  {
    actorId,
    form,
    reviewLinkKey,
    now,
  }: {
    actorId: string;
    form: FormLike;
    reviewLinkKey: ReviewLinkKey;
    now?: Date;
  },
): Promise<FulfillmentFormResult> {
  const result = await transitionFulfillment(db, {
    actorId,
    input: fulfillmentInputFromForm(form),
    reviewLinkKey,
    now,
  });
  const failure = (
    message: string,
    fieldErrors?: Partial<Record<string, string>>,
  ): FulfillmentFormResult => ({
    state: { status: "error", message, ...(fieldErrors && { fieldErrors }) },
    emailDeliveryIds: [],
  });

  if (!result.ok) {
    switch (result.error) {
      case "INVALID_INPUT": {
        const { trackingNumber, shippingCarrier } = result.fieldErrors;
        if (!trackingNumber && !shippingCarrier) {
          return failure("Ogiltig begäran. Ladda om sidan och försök igen.");
        }
        return failure("Kontrollera de markerade fälten.", {
          ...(trackingNumber && { trackingNumber }),
          ...(shippingCarrier && { shippingCarrier: "Välj fraktbolag." }),
        });
      }
      case "NOT_FOUND":
        return failure("Beställningen finns inte längre.");
      case "INVALID_TRANSITION":
        return failure(
          `Beställningen kan inte gå från ${FULFILLMENT_STATUS_LABELS[
            result.from
          ].toLowerCase()} till ${FULFILLMENT_STATUS_LABELS[
            result.to
          ].toLowerCase()}. Den kan ha ändrats av någon annan – ladda om sidan.`,
        );
      case "PAYMENT_NOT_SETTLED":
        if (result.paymentStatus === "PENDING") {
          return failure(
            "Betalningen pågår fortfarande hos Stripe, så beställningen kan inte ändras ännu. Den avslutas av sig själv när kunden betalar eller kassan går ut. Använd ”Kontrollera med Stripe igen” om den väntat länge.",
          );
        }
        return failure(
          `Betalningen har status ${PAYMENT_STATUS_LABELS[
            result.paymentStatus
          ].toLowerCase()}, så beställningen kan inte behandlas eller skickas. Avbryt den i stället om den inte ska levereras.`,
        );
    }
  }

  let message: string;
  if (!result.changed) {
    message = "Inget att ändra.";
  } else if (result.from === "SHIPPED" && result.to === "SHIPPED") {
    message = "Spårningsuppgifterna är uppdaterade. Inget nytt mejl skickas.";
  } else if (result.to === "SHIPPED") {
    message =
      "Beställningen är markerad som skickad. Leveransbeskedet med recensionslänk skickas till kunden.";
  } else {
    message = `Leveransstatus: ${FULFILLMENT_STATUS_LABELS[result.to]}.`;
  }
  return {
    state: { status: "success", message },
    emailDeliveryIds: result.emailDeliveryIds,
  };
}

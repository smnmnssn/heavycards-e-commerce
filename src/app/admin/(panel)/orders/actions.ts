"use server";

import { refresh } from "next/cache";

import { canManageOrders } from "@/lib/auth/authorization";
import { db } from "@/lib/db/client";
import {
  INVALID_FORM_REQUEST,
  runAdminAction,
  type AdminFormState,
} from "@/server/admin/action-guard";
import { resolveOrderAttention } from "@/server/admin/orders/attention";
import { submitFulfillmentForm } from "@/server/admin/orders/fulfillment-form";
import { recheckOrderPayment } from "@/server/admin/orders/payment-recheck";
import { getCheckoutGateway } from "@/server/checkout/server";
import { sendOrderEmailsAfterResponse } from "@/server/email/server";
import type { SyncOutcome } from "@/server/payments/session-sync";
import { revalidateAfterInventoryChange } from "@/server/payments/revalidate";
import { reviewLinkKey } from "@/server/reviews/server";

/*
 * Order actions (OWNER and ADMIN, PROJECT.md §50). Each call authorizes on
 * the server; the services re-check the administrator inside their
 * transaction. Fulfillment goes only through transitionFulfillment
 * (Milestone 10), which creates the review invitation and the shipping
 * email obligation exactly once on the first SHIPPED; the email itself is
 * sent after the response, so the mail provider can never block or undo
 * the status change.
 */

const PERMISSION = {
  rule: canManageOrders,
  forbidden: "Du har inte behörighet att hantera beställningar.",
};

export async function transitionFulfillmentAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return runAdminAction(PERMISSION, async (admin) => {
    const { state, emailDeliveryIds } = await submitFulfillmentForm(db, {
      actorId: admin.id,
      form: formData,
      reviewLinkKey,
    });
    if (state.status === "success") {
      const orderId = String(formData.get("orderId"));
      if (emailDeliveryIds.length > 0) sendOrderEmailsAfterResponse(orderId);
      refresh();
    }
    return state;
  });
}

export async function resolveAttentionAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return runAdminAction(PERMISSION, async (admin) => {
    const result = await resolveOrderAttention(db, {
      actorId: admin.id,
      input: {
        orderId: formData.get("orderId"),
        attentionId: formData.get("attentionId"),
      },
    });
    if (!result.ok) {
      switch (result.error) {
        case "NOT_FOUND":
          return { status: "error", message: "Händelsen finns inte längre." };
        case "STILL_BLOCKING":
          return {
            status: "error",
            message: `Problemet kan inte markeras som hanterat medan beställningen håller ${result.heldUnits} st i lager reserverade. Kontrollera med Stripe igen.`,
          };
        case "INVALID_INPUT":
          return INVALID_FORM_REQUEST;
      }
    }
    refresh();
    return { status: "success", message: "Markerat som hanterat." };
  });
}

const RECHECK_MESSAGES: Partial<Record<SyncOutcome, string>> = {
  paid: "Stripe bekräftar betalningen. Beställningen är nu betald och lagret har dragits.",
  expired:
    "Stripe bekräftar att kassan gick ut utan betalning. Reservationen är släppt och lagret går att sälja igen.",
  failed:
    "Stripe bekräftar att betalningen misslyckades. Reservationen är släppt och lagret går att sälja igen.",
  processing:
    "Betalningen behandlas fortfarande hos Stripe. Lagret förblir reserverat.",
  open: "Kassan är fortfarande öppen hos Stripe. Lagret förblir reserverat.",
  needs_attention:
    "Stripe och HeavyCards stämmer fortfarande inte överens. Lagret förblir reserverat och problemet ligger kvar.",
};

/**
 * Asks Stripe again for a pending order's checkout and applies the answer
 * through the Milestone 9 payment service (finalize, release or nothing).
 * Stock is only ever released when Stripe reports expired or failed.
 */
export async function recheckPaymentAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return runAdminAction(PERMISSION, async (admin) => {
    const gateway = getCheckoutGateway();
    if (!gateway) {
      return {
        status: "error",
        message:
          "Stripe är inte konfigurerat. Ingenting har ändrats och lagret förblir reserverat.",
      };
    }
    const result = await recheckOrderPayment(
      { db, gateway },
      { actorId: admin.id, input: { orderId: formData.get("orderId") } },
    );
    if (!result.ok) {
      const messages = {
        INVALID_INPUT: INVALID_FORM_REQUEST,
        NOT_FOUND: {
          status: "error",
          message: "Beställningen finns inte längre.",
        },
        NOT_APPLICABLE: {
          status: "error",
          message:
            "Beställningen väntar inte längre på Stripe. Ladda om sidan.",
        },
        UNAVAILABLE: {
          status: "error",
          message:
            "Stripe kunde inte nås. Ingenting har ändrats och lagret förblir reserverat. Försök igen om en stund.",
        },
      } as const satisfies Record<typeof result.error, AdminFormState>;
      return messages[result.error];
    }
    revalidateAfterInventoryChange(result.productSlugs);
    if (result.outcome === "paid") {
      sendOrderEmailsAfterResponse(result.orderId);
    }
    refresh();
    return {
      status: "success",
      message:
        RECHECK_MESSAGES[result.outcome] ??
        "Ingen ändring hos Stripe. Lagret förblir reserverat.",
    };
  });
}

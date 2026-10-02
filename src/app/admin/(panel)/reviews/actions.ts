"use server";

import { refresh } from "next/cache";

import { canManageReviews } from "@/lib/auth/authorization";
import {
  INVALID_FORM_REQUEST,
  runAdminAction,
  type AdminFormState,
} from "@/server/admin/action-guard";
import { moderateReviewAndRevalidate } from "@/server/reviews/server";

/*
 * Review moderation (OWNER and ADMIN, PROJECT.md §47, §50). The decision
 * goes through the Milestone 11 service, which re-checks the administrator
 * in its transaction, validates the transition, audits it and returns the
 * product page to refresh; `moderateReviewAndRevalidate` refreshes it.
 *
 * There is deliberately no delete action in V1: rejecting removes a review
 * from the storefront while its row keeps the one-review-per-purchase
 * entitlement consumed (a deleted review would make the line reviewable
 * again through the customer's link).
 */

const MESSAGES = {
  APPROVED: "Recensionen är godkänd och visas på produktsidan.",
  REJECTED: "Recensionen är avvisad och visas inte i butiken.",
} as const;

export async function moderateReviewAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return runAdminAction(
    {
      rule: canManageReviews,
      forbidden: "Du har inte behörighet att moderera recensioner.",
    },
    async (admin) => {
      const result = await moderateReviewAndRevalidate({
        actorId: admin.id,
        input: {
          reviewId: formData.get("reviewId"),
          decision: formData.get("decision"),
        },
      });
      if (!result.ok) {
        switch (result.error) {
          case "INVALID_INPUT":
            return INVALID_FORM_REQUEST;
          case "NOT_FOUND":
            return { status: "error", message: "Recensionen finns inte." };
          case "INVALID_TRANSITION":
            return {
              status: "error",
              message: "Statusen kan inte ändras så. Ladda om sidan.",
            };
        }
      }
      refresh();
      return {
        status: "success",
        message: result.changed
          ? MESSAGES[result.to as keyof typeof MESSAGES]
          : "Recensionen hade redan den statusen.",
      };
    },
  );
}

"use client";

import { useActionState } from "react";

import { moderateReviewAction } from "@/app/admin/(panel)/reviews/actions";
import { Button } from "@/components/ui/button";
import type { AdminFormState } from "@/server/admin/action-guard";

const IDLE: AdminFormState = { status: "idle" };

/**
 * Approve / reject for one review. `decisions` lists what the moderation
 * rules allow from the current status (computed on the server); the
 * service validates the transition again. No delete: see the action.
 */
export function ModerationButtons({
  reviewId,
  decisions,
  label,
}: {
  reviewId: string;
  decisions: Array<"APPROVE" | "REJECT">;
  /** Names the review for screen readers, e.g. the product. */
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    moderateReviewAction,
    IDLE,
  );
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <div className="flex flex-wrap gap-3">
        {decisions.includes("APPROVE") && (
          <Button
            type="submit"
            name="decision"
            value="APPROVE"
            disabled={pending}
            aria-label={`Godkänn recensionen av ${label}`}
          >
            Godkänn
          </Button>
        )}
        {decisions.includes("REJECT") && (
          <Button
            type="submit"
            name="decision"
            value="REJECT"
            variant="secondary"
            disabled={pending}
            aria-label={`Avvisa recensionen av ${label}`}
          >
            Avvisa
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {pending ? "Sparar…" : state.status === "success" ? state.message : ""}
      </p>
      {state.status === "error" && !pending && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}

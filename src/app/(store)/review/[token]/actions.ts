"use server";

import { headers } from "next/headers";

import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import type { ReviewFieldErrors } from "@/lib/validation/reviews";
import { logSafe } from "@/server/logging/safe-log";
import { submitReview } from "@/server/reviews/submit";
import {
  clientIp,
  consumeRateLimit,
  rateLimitKey,
  REVIEW_SUBMIT_RATE_LIMIT,
} from "@/server/security/rate-limit";

export type ReviewFormState =
  | { status: "idle" }
  | { status: "success"; allReviewed: boolean }
  /** Final for this product: the form is replaced by the message. */
  | { status: "closed"; message: string }
  | { status: "error"; message: string; fieldErrors?: ReviewFieldErrors };

const INVALID_LINK_MESSAGE =
  "Länken kan inte längre användas. Den är ogiltig, har gått ut eller har redan använts.";

/**
 * Submits one review through a review link. The token in the form is the
 * only credential (it is also in the page URL); everything else is decided
 * by src/server/reviews/submit.ts. CSRF needs no extra check: no cookie or
 * session is involved, so a cross-site form could only use a token its
 * author already has (Next.js also rejects cross-origin actions). The token
 * is never logged.
 */
export async function submitReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const now = new Date();
  const limit = await consumeRateLimit(
    db,
    REVIEW_SUBMIT_RATE_LIMIT,
    rateLimitKey(
      REVIEW_SUBMIT_RATE_LIMIT,
      clientIp(await headers()),
      env.authSecret,
    ),
    now,
  );
  if (!limit.allowed) {
    return {
      status: "error",
      message: "För många försök. Vänta en stund och försök igen.",
    };
  }

  try {
    const result = await submitReview(db, {
      rawToken: formData.get("token"),
      input: {
        orderItemId: formData.get("orderItemId"),
        rating: formData.get("rating"),
        title: formData.get("title"),
        body: formData.get("body"),
        displayName: formData.get("displayName"),
      },
      now,
    });
    if (result.ok) {
      return { status: "success", allReviewed: result.remainingLines === 0 };
    }
    switch (result.error) {
      case "INVALID_INPUT":
        return {
          status: "error",
          message: "Kontrollera de markerade fälten.",
          fieldErrors: result.fieldErrors,
        };
      case "ALREADY_REVIEWED":
        return {
          status: "closed",
          message: "Du har redan recenserat den här produkten. Tack!",
        };
      case "INVALID_LINK":
        return { status: "closed", message: INVALID_LINK_MESSAGE };
    }
  } catch (error) {
    logSafe("reviews", "error", "review submission failed", { error });
    return {
      status: "error",
      message: "Det gick inte att skicka recensionen. Försök igen om en stund.",
    };
  }
}

import "server-only";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db/client";
import { env } from "@/lib/env/server";
import { logSafe } from "@/server/logging/safe-log";
import { deriveReviewLinkKey } from "@/server/domain/review-token";

import { moderateReview, type ModerationResult } from "./moderation";

/** Derives review URL tokens; from AUTH_SECRET, never logged or stored. */
export const reviewLinkKey = deriveReviewLinkKey(env.authSecret);

/**
 * Moderation for the admin UI (Milestone 12): the service, then a refresh
 * of the product page whose public reviews or rating changed. A failed
 * refresh is logged and only delays freshness by the 60 s ISR window.
 */
export async function moderateReviewAndRevalidate(params: {
  actorId: string;
  input: unknown;
}): Promise<ModerationResult> {
  const result = await moderateReview(db, params);
  if (result.ok) {
    for (const path of result.revalidatePaths) {
      try {
        revalidatePath(path);
      } catch (error) {
        logSafe("reviews", "error", "product page revalidation failed", {
          error,
        });
      }
    }
  }
  return result;
}

import "server-only";

import { generateSecureToken, hashToken } from "@/lib/security/tokens";

/**
 * Review links are sent in the shipping email and stay valid for 180 days
 * from issue, long enough for delivery, opening and a considered review
 * (PROJECT.md §44). A token can also be revoked early via `revokedAt`.
 */
export const REVIEW_TOKEN_TTL_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export type IssuedReviewToken = {
  /** Goes into the emailed URL only. Never persist or log it. */
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
};

export function issueReviewToken(now: Date): IssuedReviewToken {
  const rawToken = generateSecureToken();
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + REVIEW_TOKEN_TTL_DAYS * DAY_MS),
  };
}

export function isReviewTokenUsable(
  token: { expiresAt: Date; revokedAt: Date | null },
  now: Date,
): boolean {
  return token.revokedAt === null && token.expiresAt.getTime() > now.getTime();
}

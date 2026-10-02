import "server-only";

import { createHmac, hkdfSync } from "node:crypto";

import { generateSecureToken, hashToken } from "@/lib/security/tokens";

/*
 * Review invitation tokens (PROJECT.md §44, §45).
 *
 * The shipping email must carry the raw token, and the outbox may render
 * that email several times (retries with the same provider idempotency key,
 * which requires an identical payload). Storing the raw token so a retry
 * can rebuild the URL would put usable links in the database. Instead:
 *
 *   nonce     = 256 random bits (CSPRNG), stored
 *   rawToken  = HMAC-SHA256(reviewLinkKey, nonce), never stored
 *   tokenHash = SHA-256(rawToken), stored and used for lookups
 *
 * `reviewLinkKey` is derived from AUTH_SECRET (HKDF with its own label, so
 * it is independent of every other use of that secret). Consequences:
 * - every render re-derives the same URL, so retries never mint new links;
 * - a database copy alone (nonce + hash) yields no working link: the key
 *   lives only in the environment;
 * - the raw token is unpredictable without the key, and HMAC output is
 *   indistinguishable from 256 random bits;
 * - verification needs no key: the URL token is hashed and looked up.
 *   Rotating AUTH_SECRET therefore keeps delivered links working; only an
 *   email not yet sent at that moment can no longer render its link.
 */

/**
 * Review links stay valid for 180 days from shipping (PROJECT.md §44
 * suggests about 180): long enough for delivery, unboxing and a considered
 * review weeks later, without being permanent.
 */
export const REVIEW_TOKEN_TTL_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_LABEL = "heavycards/review-link/v1";

/** Opaque key for deriving review tokens. Never log or serialize it. */
export type ReviewLinkKey = { readonly bytes: Buffer };

export function deriveReviewLinkKey(authSecret: string): ReviewLinkKey {
  const bytes = Buffer.from(
    hkdfSync("sha256", authSecret, "heavycards", KEY_LABEL, 32),
  );
  return Object.freeze({ bytes });
}

/** The raw URL token for a stored nonce (43 characters, base64url). */
export function deriveReviewToken(key: ReviewLinkKey, nonce: string): string {
  return createHmac("sha256", key.bytes)
    .update(`review-token:${nonce}`, "utf8")
    .digest("base64url");
}

export type NewReviewInvitation = {
  nonce: string;
  tokenHash: string;
  expiresAt: Date;
};

/** Values to store for a new invitation. Contains no raw token. */
export function newReviewInvitation(
  key: ReviewLinkKey,
  now: Date,
): NewReviewInvitation {
  const nonce = generateSecureToken();
  return {
    nonce,
    tokenHash: hashToken(deriveReviewToken(key, nonce)),
    expiresAt: new Date(now.getTime() + REVIEW_TOKEN_TTL_DAYS * DAY_MS),
  };
}

/**
 * The raw token of a stored invitation, or null when it cannot be derived
 * any more (AUTH_SECRET was rotated after the invitation was created).
 */
export function rawReviewToken(
  key: ReviewLinkKey,
  stored: { nonce: string; tokenHash: string },
): string | null {
  const rawToken = deriveReviewToken(key, stored.nonce);
  return hashToken(rawToken) === stored.tokenHash ? rawToken : null;
}

export function isReviewTokenUsable(
  token: { expiresAt: Date; revokedAt: Date | null },
  now: Date,
): boolean {
  return token.revokedAt === null && token.expiresAt.getTime() > now.getTime();
}

/** Customer-facing path of a review link. */
export const reviewPath = (rawToken: string) => `/review/${rawToken}`;

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
 * `reviewLinkKey` is derived (HKDF with its own label) from
 * REVIEW_LINK_SECRET, a secret used for nothing else (Milestone 14; before
 * that, and still outside production when it is unset, from AUTH_SECRET).
 * Consequences:
 * - every render re-derives the same URL, so retries never mint new links;
 * - a database copy alone (nonce + hash) yields no working link: the key
 *   lives only in the environment;
 * - the raw token is unpredictable without the key, and HMAC output is
 *   indistinguishable from 256 random bits;
 * - verification needs no key: the URL token is hashed and looked up.
 *   Rotating the secret therefore keeps delivered links working.
 * - rendering needs the key the invitation was created with. Previous keys
 *   (the old secret after a rotation, or AUTH_SECRET for invitations created
 *   before REVIEW_LINK_SECRET existed) are kept as fallbacks, so a shipping
 *   email still waiting to be sent renders the same link. New invitations
 *   always use the current key.
 */

/**
 * Review links stay valid for 180 days from shipping (PROJECT.md §44
 * suggests about 180): long enough for delivery, unboxing and a considered
 * review weeks later, without being permanent.
 */
export const REVIEW_TOKEN_TTL_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_LABEL = "heavycards/review-link/v1";

/**
 * Opaque key for deriving review tokens: the current key and, for rendering
 * links of older invitations only, previous ones. Never log or serialize it.
 */
export type ReviewLinkKey = {
  readonly bytes: Buffer;
  readonly previous: readonly Buffer[];
};

const keyBytes = (secret: string) =>
  Buffer.from(hkdfSync("sha256", secret, "heavycards", KEY_LABEL, 32));

export function deriveReviewLinkKey(
  secret: string,
  { previousSecrets = [] }: { previousSecrets?: readonly string[] } = {},
): ReviewLinkKey {
  return Object.freeze({
    bytes: keyBytes(secret),
    previous: Object.freeze(
      previousSecrets.filter((old) => old !== secret).map(keyBytes),
    ),
  });
}

const tokenFor = (bytes: Buffer, nonce: string) =>
  createHmac("sha256", bytes)
    .update(`review-token:${nonce}`, "utf8")
    .digest("base64url");

/** The raw URL token for a stored nonce under the current key (43 characters). */
export function deriveReviewToken(key: ReviewLinkKey, nonce: string): string {
  return tokenFor(key.bytes, nonce);
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
 * The raw token of a stored invitation, derived with whichever known key it
 * was created with; null when none matches (the secret it was created with
 * is no longer configured).
 */
export function rawReviewToken(
  key: ReviewLinkKey,
  stored: { nonce: string; tokenHash: string },
): string | null {
  for (const bytes of [key.bytes, ...key.previous]) {
    const rawToken = tokenFor(bytes, stored.nonce);
    if (hashToken(rawToken) === stored.tokenHash) return rawToken;
  }
  return null;
}

export function isReviewTokenUsable(
  token: { expiresAt: Date; revokedAt: Date | null },
  now: Date,
): boolean {
  return token.revokedAt === null && token.expiresAt.getTime() > now.getTime();
}

/** Customer-facing path of a review link. */
export const reviewPath = (rawToken: string) => `/review/${rawToken}`;

/**
 * The application's review-link key from its configured secrets: the
 * dedicated REVIEW_LINK_SECRET when set (with the previous one and
 * AUTH_SECRET as rendering fallbacks for older invitations), otherwise
 * AUTH_SECRET, as before Milestone 14. Production requires the dedicated
 * secret (src/lib/env/schema.ts).
 */
export function reviewLinkKeyFromSecrets({
  reviewLinkSecret,
  previousReviewLinkSecret,
  authSecret,
}: {
  reviewLinkSecret: string | null;
  previousReviewLinkSecret: string | null;
  authSecret: string;
}): ReviewLinkKey {
  if (!reviewLinkSecret) return deriveReviewLinkKey(authSecret);
  return deriveReviewLinkKey(reviewLinkSecret, {
    previousSecrets: [previousReviewLinkSecret, authSecret].filter(
      (secret): secret is string => Boolean(secret),
    ),
  });
}

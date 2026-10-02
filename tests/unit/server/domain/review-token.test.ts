import { describe, expect, it } from "vitest";

import {
  generateSecureToken,
  hashToken,
  isWellFormedToken,
} from "@/lib/security/tokens";
import {
  deriveReviewLinkKey,
  reviewLinkKeyFromSecrets,
  deriveReviewToken,
  isReviewTokenUsable,
  newReviewInvitation,
  rawReviewToken,
  REVIEW_TOKEN_TTL_DAYS,
  reviewPath,
} from "@/server/domain/review-token";

const now = new Date("2026-09-30T12:00:00Z");
const key = deriveReviewLinkKey("unit-test-auth-secret-0123456789abcdef");

describe("secure tokens", () => {
  it("generates unique 256-bit base64url tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSecureToken));

    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(isWellFormedToken(token)).toBe(true);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("hashes to lowercase hex SHA-256", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it.each([
    "",
    "short",
    "a".repeat(44),
    "a".repeat(42) + "=",
    "../../etc/passwd",
    hashToken("x"), // a stored hash is 64 hex characters, never a token
  ])("rejects malformed token %j", (token) => {
    expect(isWellFormedToken(token)).toBe(false);
  });
});

describe("review invitation tokens", () => {
  it("stores a random nonce and a hash, never the raw token", () => {
    const invitation = newReviewInvitation(key, now);
    const rawToken = deriveReviewToken(key, invitation.nonce);

    expect(isWellFormedToken(invitation.nonce)).toBe(true);
    expect(isWellFormedToken(rawToken)).toBe(true);
    expect(invitation.tokenHash).toBe(hashToken(rawToken));
    expect(Object.values(invitation).map(String)).not.toContain(rawToken);
    expect(invitation.nonce).not.toBe(rawToken);
  });

  it("re-derives the identical token from the stored values (stable email retries)", () => {
    const invitation = newReviewInvitation(key, now);

    const first = rawReviewToken(key, invitation);
    const again = rawReviewToken(
      deriveReviewLinkKey("unit-test-auth-secret-0123456789abcdef"),
      invitation,
    );

    expect(first).not.toBeNull();
    expect(again).toBe(first);
  });

  it("mints a different token for every invitation", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => {
        const invitation = newReviewInvitation(key, now);
        return rawReviewToken(key, invitation);
      }),
    );
    expect(tokens.size).toBe(50);
  });

  it("cannot derive a working token without the server key", () => {
    const invitation = newReviewInvitation(key, now);
    const otherKey = deriveReviewLinkKey("another-secret-0123456789abcdefghij");

    // What a database copy alone offers: the nonce and the hash.
    for (const candidate of [invitation.nonce, invitation.tokenHash]) {
      expect(hashToken(candidate)).not.toBe(invitation.tokenHash);
    }
    expect(rawReviewToken(otherKey, invitation)).toBeNull();
  });

  it("separates the review key from other uses of the secret", () => {
    const secret = "unit-test-auth-secret-0123456789abcdef";
    expect(deriveReviewLinkKey(secret).bytes).toHaveLength(32);
    expect(deriveReviewLinkKey(secret).bytes.toString("utf8")).not.toContain(
      secret,
    );
  });

  it(`expires after ${REVIEW_TOKEN_TTL_DAYS} days`, () => {
    const { expiresAt } = newReviewInvitation(key, now);

    expect(expiresAt.toISOString()).toBe("2027-03-29T12:00:00.000Z");
  });

  it("builds the customer path from the raw token only", () => {
    const token = generateSecureToken();
    expect(reviewPath(token)).toBe(`/review/${token}`);
  });
});

describe("review-link key transition (Milestone 14)", () => {
  const AUTH = "unit-test-auth-secret-0123456789abcdef";
  const DEDICATED = "unit-test-review-link-secret-0123456789";

  it("still renders links of invitations created with AUTH_SECRET", () => {
    const legacy = newReviewInvitation(deriveReviewLinkKey(AUTH), now);
    const ring = reviewLinkKeyFromSecrets({
      reviewLinkSecret: DEDICATED,
      previousReviewLinkSecret: null,
      authSecret: AUTH,
    });

    expect(rawReviewToken(ring, legacy)).toBe(
      rawReviewToken(deriveReviewLinkKey(AUTH), legacy),
    );
  });

  it("creates new invitations with the dedicated key only", () => {
    const ring = reviewLinkKeyFromSecrets({
      reviewLinkSecret: DEDICATED,
      previousReviewLinkSecret: null,
      authSecret: AUTH,
    });
    const invitation = newReviewInvitation(ring, now);

    expect(rawReviewToken(deriveReviewLinkKey(DEDICATED), invitation)).toBe(
      rawReviewToken(ring, invitation),
    );
    expect(rawReviewToken(deriveReviewLinkKey(AUTH), invitation)).toBeNull();
  });

  it("keeps links of the previous dedicated secret renderable after a rotation", () => {
    const old = "old-review-link-secret-0123456789abcdef";
    const before = newReviewInvitation(deriveReviewLinkKey(old), now);
    const ring = reviewLinkKeyFromSecrets({
      reviewLinkSecret: DEDICATED,
      previousReviewLinkSecret: old,
      authSecret: AUTH,
    });

    expect(rawReviewToken(ring, before)).not.toBeNull();
    // Without the previous secret the old invitation cannot be rendered.
    expect(
      rawReviewToken(
        reviewLinkKeyFromSecrets({
          reviewLinkSecret: DEDICATED,
          previousReviewLinkSecret: null,
          authSecret: AUTH,
        }),
        before,
      ),
    ).toBeNull();
  });

  it("uses AUTH_SECRET when no dedicated secret is configured (development)", () => {
    const ring = reviewLinkKeyFromSecrets({
      reviewLinkSecret: null,
      previousReviewLinkSecret: null,
      authSecret: AUTH,
    });
    expect(ring.bytes.equals(deriveReviewLinkKey(AUTH).bytes)).toBe(true);
    expect(ring.previous).toHaveLength(0);
  });
});

describe("isReviewTokenUsable", () => {
  const future = new Date(now.getTime() + 1_000);

  it("accepts an unexpired, unrevoked token", () => {
    expect(
      isReviewTokenUsable({ expiresAt: future, revokedAt: null }, now),
    ).toBe(true);
  });

  it("rejects expired tokens, including at the exact expiry instant", () => {
    expect(isReviewTokenUsable({ expiresAt: now, revokedAt: null }, now)).toBe(
      false,
    );
  });

  it("rejects revoked tokens", () => {
    expect(
      isReviewTokenUsable({ expiresAt: future, revokedAt: now }, now),
    ).toBe(false);
  });
});

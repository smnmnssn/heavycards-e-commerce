import { describe, expect, it } from "vitest";

import {
  generateSecureToken,
  hashToken,
  isWellFormedToken,
} from "@/lib/security/tokens";
import {
  REVIEW_TOKEN_TTL_DAYS,
  isReviewTokenUsable,
  issueReviewToken,
} from "@/server/domain/review-token";

const now = new Date("2026-09-30T12:00:00Z");

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
  ])("rejects malformed token %j", (token) => {
    expect(isWellFormedToken(token)).toBe(false);
  });
});

describe("issueReviewToken", () => {
  it("returns the raw token for the URL and only its hash for storage", () => {
    const issued = issueReviewToken(now);

    expect(isWellFormedToken(issued.rawToken)).toBe(true);
    expect(issued.tokenHash).toBe(hashToken(issued.rawToken));
    expect(issued.tokenHash).not.toContain(issued.rawToken);
  });

  it(`expires after ${REVIEW_TOKEN_TTL_DAYS} days`, () => {
    const { expiresAt } = issueReviewToken(now);

    expect(expiresAt.toISOString()).toBe("2027-03-29T12:00:00.000Z");
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

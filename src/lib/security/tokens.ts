import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque secret tokens for links sent by email (review links, and later admin
 * invitations). The raw token is only ever placed in the URL; the database
 * stores its SHA-256 hash.
 *
 * A fast hash is appropriate here (unlike passwords): tokens carry 256 bits of
 * randomness, so a leaked hash cannot be brute-forced back to a usable token.
 */

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 256-bit cryptographically secure token, base64url-encoded (43 chars). */
export function generateSecureToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Lowercase hex SHA-256, matching the `CHAR(64)` token hash columns. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Cheap shape check to reject garbage before touching the database. Lookup is
 * by hash, so the comparison happens inside an index and leaks no timing
 * information about stored tokens.
 */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

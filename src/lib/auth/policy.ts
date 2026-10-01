/**
 * Admin authentication policy values shared by the auth configuration, the
 * forms and the documentation (docs/architecture.md → Admin authentication).
 */

/**
 * Length beats composition rules (NIST SP 800-63B): no required character
 * classes, any characters allowed, paste and password managers welcome.
 */
export const MIN_PASSWORD_LENGTH = 12;
/** Bounds hashing cost; long passphrases still fit comfortably. */
export const MAX_PASSWORD_LENGTH = 128;

/** Auth cookies are named `heavycards-admin.*` (`__Secure-` on HTTPS). */
export const ADMIN_COOKIE_PREFIX = "heavycards-admin";

/** Absolute session lifetime. Sessions are not extended by activity. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Password-reset links are valid for one hour and can be used once. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/** Invitation links are valid for 72 hours and can be used once. */
export const INVITATION_TTL_HOURS = 72;

/**
 * Better Auth endpoints the application uses. Everything else (sign-up,
 * profile updates, account linking, email change, ...) is unreachable through
 * the HTTP handler, so role, isActive and identity data can only change
 * through server code that authorizes the caller first.
 */
export const ALLOWED_AUTH_ENDPOINTS = [
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/request-password-reset",
  "/reset-password",
  "/ok",
  "/error",
] as const;

/**
 * Endpoints disabled inside Better Auth itself (exact-path list). The route
 * handler additionally rejects any path not in ALLOWED_AUTH_ENDPOINTS, which
 * also covers parameterised paths such as `/reset-password/:token`.
 */
export const DISABLED_AUTH_ENDPOINTS = [
  "/sign-up/email",
  "/sign-in/social",
  "/callback/:id",
  "/update-user",
  "/update-session",
  "/change-email",
  "/change-password",
  "/set-password",
  "/delete-user",
  "/delete-user/callback",
  "/verify-email",
  "/send-verification-email",
  "/verify-password",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/link-social",
  "/list-accounts",
  "/unlink-account",
  "/account-info",
  "/refresh-token",
  "/get-access-token",
] as const;

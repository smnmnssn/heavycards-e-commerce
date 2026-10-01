/** Admin URLs. Kept free of server imports so the proxy and forms share them. */

export const ADMIN_HOME_PATH = "/admin";
export const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_FORGOT_PASSWORD_PATH = "/admin/forgot-password";
export const ADMIN_RESET_PASSWORD_PATH = "/admin/reset-password";
export const ADMIN_INVITE_PATH = "/admin/invite";
export const ADMIN_USERS_PATH = "/admin/users";

/**
 * Set by the proxy on admin requests: the path being rendered, so a login
 * redirect from server code can return there afterwards.
 */
export const ADMIN_PATH_HEADER = "x-heavycards-admin-path";

/** Reachable without a session (sign-in, password reset, invitations). */
export const PUBLIC_ADMIN_PATHS = [
  ADMIN_LOGIN_PATH,
  ADMIN_FORGOT_PASSWORD_PATH,
  ADMIN_RESET_PASSWORD_PATH,
  ADMIN_INVITE_PATH,
] as const;

export function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_HOME_PATH || pathname.startsWith("/admin/");
}

const PROBE_ORIGIN = "http://heavycards.invalid";

/**
 * Returns `next` if it is a safe post-login destination, otherwise /admin.
 *
 * Only same-origin, protected admin paths are accepted, which rules out open
 * redirects (`//evil.example`, `/\evil.example`, `https://…`, `javascript:`)
 * and loops back to the public auth pages.
 */
export function safeAdminRedirect(next: unknown): string {
  if (typeof next !== "string" || next.length > 2048) return ADMIN_HOME_PATH;
  // Only a single leading slash; no backslashes or control characters that
  // browsers normalize into a different origin.
  if (!/^\/(?![/\\])/.test(next) || /[\\\u0000-\u001f\u007f]/.test(next)) {
    return ADMIN_HOME_PATH;
  }
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return ADMIN_HOME_PATH;
  }
  if (url.origin !== PROBE_ORIGIN) return ADMIN_HOME_PATH;
  if (!isAdminPath(url.pathname) || isPublicAdminPath(url.pathname)) {
    return ADMIN_HOME_PATH;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Login URL that returns to `pathname` (plus query) after signing in. */
export function loginUrlFor(pathnameWithSearch: string): string {
  const next = safeAdminRedirect(pathnameWithSearch);
  return next === ADMIN_HOME_PATH
    ? ADMIN_LOGIN_PATH
    : `${ADMIN_LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}
